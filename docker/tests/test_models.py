from datetime import datetime, timezone

import pytest

from photo_gate.models import (
    AlbumIdentity,
    PhotoPrismPhoto,
    PreviewSettings,
    ThumbSettings,
)


def test_album_identity_rejects_unsafe_album_id():
    with pytest.raises(ValueError, match="album_id"):
        AlbumIdentity("../private", "Private", "albumUid001")


def test_photo_rejects_naive_taken_at():
    with pytest.raises(ValueError, match="timezone"):
        PhotoPrismPhoto(
            uid="photo001",
            hash="a" * 40,
            title="Photo",
            taken_at=datetime(2026, 6, 1),
            width=100,
            height=100,
        )


def test_settings_cannot_disable_metadata_stripping():
    with pytest.raises(ValueError, match="cannot be disabled"):
        ThumbSettings(strip_metadata=False)
    with pytest.raises(ValueError, match="cannot be disabled"):
        PreviewSettings(strip_metadata=False)


def test_valid_photo_model():
    photo = PhotoPrismPhoto(
        uid="photo001",
        hash="a" * 40,
        title="Photo",
        taken_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        width=100,
        height=100,
    )
    assert photo.uid == "photo001"
