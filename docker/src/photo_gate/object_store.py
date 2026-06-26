from typing import Protocol


class ObjectStoreError(Exception):
    """Raised when an object store operation fails."""


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None:
        """Upload bytes under the given key with the specified content type."""
        ...

    async def get(self, key: str) -> bytes | None:
        """Return raw bytes for the given key, or None if the object does not exist."""
        ...

    async def delete(self, key: str) -> None:
        """Delete the object at the given key. Best-effort; no-op if object does not exist."""
        ...
