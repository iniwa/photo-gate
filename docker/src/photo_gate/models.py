from dataclasses import dataclass, field
from datetime import datetime
import re


_SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$", re.ASCII)
_SAFE_HASH = re.compile(r"^[0-9a-f]{40}$", re.ASCII)


def _require_safe_id(value: str, name: str) -> None:
    if not _SAFE_ID.fullmatch(value):
        raise ValueError(f"{name} must be a non-empty safe identifier")


def _require_aware_datetime(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must include a timezone")


@dataclass
class AlbumIdentity:
    album_id: str
    title: str
    photoprism_album_uid: str

    def __post_init__(self) -> None:
        _require_safe_id(self.album_id, "album_id")
        _require_safe_id(self.photoprism_album_uid, "photoprism_album_uid")


@dataclass
class PhotoPrismPhoto:
    uid: str
    hash: str
    title: str
    taken_at: datetime
    width: int
    height: int

    def __post_init__(self) -> None:
        _require_safe_id(self.uid, "photo uid")
        if not _SAFE_HASH.fullmatch(self.hash):
            raise ValueError("photo hash must be a 40-character lowercase hex string")
        _require_aware_datetime(self.taken_at, "taken_at")
        if self.width < 1 or self.height < 1:
            raise ValueError("photo dimensions must be positive")


@dataclass
class ThumbSettings:
    long_edge: int = 640
    format: str = "webp"
    quality: int = 80
    strip_metadata: bool = True

    def __post_init__(self) -> None:
        if self.long_edge < 1:
            raise ValueError("thumb long_edge must be positive")
        if self.format != "webp":
            raise ValueError("thumb format must be webp")
        if not 1 <= self.quality <= 100:
            raise ValueError("thumb quality must be between 1 and 100")
        if not self.strip_metadata:
            raise ValueError("thumb metadata stripping cannot be disabled")


@dataclass
class PreviewSettings:
    long_edge: int = 3840
    format: str = "jpg"
    quality: int = 88
    strip_metadata: bool = True

    def __post_init__(self) -> None:
        if self.long_edge < 1:
            raise ValueError("preview long_edge must be positive")
        if self.format != "jpg":
            raise ValueError("preview format must be jpg")
        if not 1 <= self.quality <= 100:
            raise ValueError("preview quality must be between 1 and 100")
        if not self.strip_metadata:
            raise ValueError("preview metadata stripping cannot be disabled")


@dataclass
class ImageSettings:
    thumb: ThumbSettings = field(default_factory=ThumbSettings)
    preview: PreviewSettings = field(default_factory=PreviewSettings)


@dataclass
class GeneratedObject:
    key: str
    content_type: str
    data: bytes
