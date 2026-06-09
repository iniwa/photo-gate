from typing import Protocol


class ObjectStoreError(Exception):
    """Raised when an object store operation fails."""


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None:
        """Upload bytes under the given key with the specified content type."""
        ...
