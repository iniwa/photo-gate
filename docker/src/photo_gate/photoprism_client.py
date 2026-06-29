import re
from dataclasses import dataclass
from datetime import datetime

import httpx

from .models import PhotoPrismPhoto

_SAFE_HASH = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
_SAFE_UID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$", re.ASCII)
_PHOTO_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$", re.ASCII
)
_TITLE_MAX_CODE_POINTS = 1024
# PhotoPrism preview sizes the client may request. Never original/raw.
_ALLOWED_SIZES = frozenset(
    ["fit_720", "fit_1280", "fit_1920", "fit_2048", "fit_2560", "fit_3840"]
)


def _is_valid_album_title(value: object) -> bool:
    if not isinstance(value, str) or len(value) == 0:
        return False
    if value != value.strip():
        return False
    if re.search(r'[\x00-\x1f\x7f]', value):
        return False
    if sum(1 for _ in value) > _TITLE_MAX_CODE_POINTS:
        return False
    return True


def _normalize_photo_timestamp(value: object) -> str:
    if not isinstance(value, str) or not _PHOTO_TIMESTAMP_RE.match(value):
        raise PhotoPrismError("Album UpdatedAt is not a valid UTC timestamp")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PhotoPrismError("Album UpdatedAt is not a valid UTC timestamp") from exc
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class PhotoPrismError(Exception):
    pass


@dataclass(frozen=True)
class PhotoPrismAlbum:
    """Validated PhotoPrism album row. raw_uid must never appear in published output."""

    raw_uid: str
    title: str
    photo_count: int | None
    updated_at: str | None  # Docker seconds form (YYYY-MM-DDTHH:mm:ssZ) or None


class PhotoPrismClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        cf_client_id: str | None = None,
        cf_client_secret: str | None = None,
        page_size: int = 500,
        _transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if page_size < 1:
            raise ValueError("page_size must be positive")
        self._page_size = page_size
        headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
        if cf_client_id:
            headers["CF-Access-Client-Id"] = cf_client_id
        if cf_client_secret:
            headers["CF-Access-Client-Secret"] = cf_client_secret
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0),
            transport=_transport,
        )

    async def __aenter__(self) -> "PhotoPrismClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self._client.aclose()

    async def list_album_photos(
        self, album_uid: str
    ) -> tuple[list[PhotoPrismPhoto], str]:
        """
        Returns (photos, preview_token).
        Paginates until X-Count < X-Limit.
        Raises PhotoPrismError for HTTP errors, missing token, or missing identifiers.
        """
        photos: list[PhotoPrismPhoto] = []
        preview_token: str | None = None
        offset = 0

        while True:
            try:
                response = await self._client.get(
                    "/api/v1/photos",
                    params={
                        "s": album_uid,
                        "primary": "true",
                        "count": self._page_size,
                        "offset": offset,
                    },
                )
            except httpx.HTTPError as exc:
                raise PhotoPrismError("PhotoPrism photo list request failed") from exc

            if response.status_code != 200:
                raise PhotoPrismError(
                    f"PhotoPrism photo list returned HTTP {response.status_code}"
                )

            if preview_token is None:
                token_value = response.headers.get("X-Preview-Token")
                if not token_value:
                    raise PhotoPrismError(
                        "X-Preview-Token header missing from PhotoPrism response"
                    )
                preview_token = token_value

            try:
                results = response.json()
                x_count = int(response.headers.get("X-Count", len(results)))
                x_limit = int(response.headers.get("X-Limit", self._page_size))
            except (ValueError, TypeError) as exc:
                raise PhotoPrismError("PhotoPrism photo list response is malformed") from exc
            if not isinstance(results, list) or x_count < 0 or x_limit < 1:
                raise PhotoPrismError("PhotoPrism photo list response is malformed")

            for item in results:
                if not isinstance(item, dict):
                    raise PhotoPrismError("PhotoPrism photo entry is malformed")
                uid = item.get("UID") or item.get("Uid") or ""
                hash_val = item.get("Hash") or ""

                if not uid:
                    raise PhotoPrismError("Photo entry missing UID")
                if not _SAFE_UID.match(uid):
                    raise PhotoPrismError(f"Photo UID contains unsafe characters")
                if not hash_val:
                    raise PhotoPrismError(f"Photo uid={uid!r} missing Hash")
                if not _SAFE_HASH.match(hash_val):
                    raise PhotoPrismError(
                        f"Photo uid={uid!r} has non-hex Hash (len={len(hash_val)})"
                    )

                taken_at_str: str = item.get("TakenAt") or item.get("TakenAtLocal") or ""
                try:
                    taken_at = datetime.fromisoformat(
                        taken_at_str.replace("Z", "+00:00")
                    )
                except (ValueError, AttributeError) as exc:
                    raise PhotoPrismError(
                        f"Photo uid={uid!r} has invalid TakenAt"
                    ) from exc

                try:
                    photo = PhotoPrismPhoto(
                        uid=uid,
                        hash=hash_val,
                        title=item.get("Title") or "",
                        taken_at=taken_at,
                        width=int(item.get("Width", 0)),
                        height=int(item.get("Height", 0)),
                    )
                except (TypeError, ValueError) as exc:
                    raise PhotoPrismError(
                        f"Photo uid={uid!r} has malformed fields"
                    ) from exc
                photos.append(photo)

            if x_count < x_limit:
                break
            offset += x_limit

        assert preview_token is not None
        return photos, preview_token

    async def list_albums(self) -> list[PhotoPrismAlbum]:
        """
        Return validated PhotoPrism albums from GET /api/v1/albums.
        Paginates using X-Count / X-Limit headers (same pattern as list_album_photos).
        Raises PhotoPrismError for HTTP errors, malformed responses, or invalid fields.
        Error messages are sanitized: no URL, token, raw UID, or response body.
        """
        albums: list[PhotoPrismAlbum] = []
        offset = 0

        while True:
            try:
                response = await self._client.get(
                    "/api/v1/albums",
                    params={"count": self._page_size, "offset": offset, "type": "album"},
                )
            except httpx.HTTPError as exc:
                raise PhotoPrismError("PhotoPrism album list request failed") from exc

            if response.status_code != 200:
                raise PhotoPrismError(
                    f"PhotoPrism album list returned HTTP {response.status_code}"
                )

            try:
                results = response.json()
                x_count = int(response.headers.get("X-Count", len(results)))
                x_limit = int(response.headers.get("X-Limit", self._page_size))
            except (ValueError, TypeError) as exc:
                raise PhotoPrismError(
                    "PhotoPrism album list response is malformed"
                ) from exc

            if not isinstance(results, list) or x_count < 0 or x_limit < 1:
                raise PhotoPrismError("PhotoPrism album list response is malformed")

            for item in results:
                if not isinstance(item, dict):
                    raise PhotoPrismError("PhotoPrism album entry is malformed")

                type_val = item.get("Type")
                if type_val is None:
                    type_val = item.get("type")
                if not isinstance(type_val, str) or type_val != "album":
                    continue

                uid = item.get("UID") or item.get("Uid") or ""
                if not uid:
                    raise PhotoPrismError("Album entry missing UID")
                if not _SAFE_UID.match(uid):
                    raise PhotoPrismError("Album UID contains unsafe characters")

                raw_title = item.get("Title") or ""
                if not _is_valid_album_title(raw_title):
                    raise PhotoPrismError("Album title failed validation")

                photo_count_raw = item.get("PhotoCount")
                if photo_count_raw is None:
                    photo_count = None
                else:
                    try:
                        pc = int(photo_count_raw)
                    except (ValueError, TypeError) as exc:
                        raise PhotoPrismError(
                            "Album PhotoCount is not a valid integer"
                        ) from exc
                    if pc < 0:
                        raise PhotoPrismError("Album PhotoCount is negative")
                    photo_count = pc

                updated_at_raw = item.get("UpdatedAt") or None
                updated_at = (
                    _normalize_photo_timestamp(updated_at_raw)
                    if updated_at_raw
                    else None
                )
                albums.append(
                    PhotoPrismAlbum(
                        raw_uid=uid,
                        title=raw_title,
                        photo_count=photo_count,
                        updated_at=updated_at,
                    )
                )

            if x_count < x_limit:
                break
            offset += x_limit

        return albums

    async def download_preview(
        self, hash_val: str, preview_token: str, size: str
    ) -> bytes:
        """
        Downloads a PhotoPrism-generated preview.
        Raises ValueError for disallowed sizes or malformed hash.
        Raises PhotoPrismError for HTTP errors or non-image responses.
        Credentials and preview token are never included in error messages.
        """
        if size not in _ALLOWED_SIZES:
            raise ValueError(
                f"Preview size {size!r} not in allowlist {sorted(_ALLOWED_SIZES)}"
            )
        if not _SAFE_HASH.match(hash_val):
            raise ValueError(f"Hash is not a 40-char hex string")

        try:
            response = await self._client.get(
                f"/api/v1/t/{hash_val}/{preview_token}/{size}"
            )
        except httpx.HTTPError as exc:
            raise PhotoPrismError(
                f"Preview download request failed "
                f"(hash_prefix={hash_val[:8]!r}, size={size!r})"
            ) from exc

        if response.status_code != 200:
            raise PhotoPrismError(
                f"Preview download returned HTTP {response.status_code} "
                f"(hash_prefix={hash_val[:8]!r}, size={size!r})"
            )

        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            raise PhotoPrismError(
                f"Preview response has non-image content-type {content_type!r} "
                f"(hash_prefix={hash_val[:8]!r})"
            )

        return response.content
