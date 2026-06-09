from typing import Protocol


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None:
        """Upload bytes under the given key with the specified content type."""
        ...
