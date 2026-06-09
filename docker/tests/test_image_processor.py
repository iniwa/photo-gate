"""
Image processor tests.

Requires system libvips for pyvips. If libvips is unavailable, all tests are
skipped with a clear message rather than replaced by Pillow-only tests.

Pillow is used only to create EXIF/GPS-bearing input fixtures and to inspect
output metadata. pyvips is used in the runtime code under test.
"""

import io

import pytest

try:
    import pyvips  # noqa: F401
    _PYVIPS_AVAILABLE = True
except Exception:
    _PYVIPS_AVAILABLE = False

try:
    from PIL import Image  # noqa: F401
    _PILLOW_AVAILABLE = True
except ImportError:
    _PILLOW_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not _PYVIPS_AVAILABLE,
    reason="libvips not available — image processor tests skipped",
)

if _PYVIPS_AVAILABLE:
    from photo_gate.image_processor import ImageProcessor, MetadataValidationError
    from photo_gate.models import PreviewSettings, ThumbSettings


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_jpeg_with_exif_and_gps(width: int = 1000, height: int = 800) -> bytes:
    """Create a JPEG with EXIF Make/Model and GPS coordinates using Pillow."""
    from PIL import Image

    img = Image.new("RGB", (width, height), color=(80, 120, 160))
    exif = img.getexif()
    exif[0x010F] = "TestMake"
    exif[0x0110] = "TestModel"

    gps_ifd = exif.get_ifd(0x8825)
    gps_ifd[1] = "N"
    gps_ifd[2] = ((35, 1), (41, 1), (0, 1))
    gps_ifd[3] = "E"
    gps_ifd[4] = ((139, 1), (41, 1), (0, 1))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes(), quality=90)
    return buf.getvalue()


def _pillow_exif(data: bytes) -> dict:
    """Return raw EXIF dict from Pillow (empty if none)."""
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    return dict(img.getexif())


def _pillow_gps_ifd(data: bytes) -> dict:
    """Return GPS IFD dict from Pillow (empty if none)."""
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    return dict(img.getexif().get_ifd(0x8825))


# ---------------------------------------------------------------------------
# Thumb tests (WebP, ≤640px long edge)
# ---------------------------------------------------------------------------


def test_thumb_output_is_webp():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert img.format == "WEBP"


def test_thumb_long_edge_at_most_640():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert max(img.width, img.height) <= 640


def test_thumb_no_upscale_when_small():
    src = _make_jpeg_with_exif_and_gps(200, 150)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert img.width == 200
    assert img.height == 150


def test_thumb_uses_supplied_settings():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src, ThumbSettings(long_edge=320, quality=65))

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert max(img.width, img.height) <= 320


def test_thumb_no_exif_in_output():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    exif = _pillow_exif(result)
    assert not exif, f"EXIF data found in thumb output: {exif}"


def test_thumb_no_gps_in_output():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    gps = _pillow_gps_ifd(result)
    assert not gps, f"GPS data found in thumb output: {gps}"


def test_thumb_is_valid_image():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_thumb(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    img.verify()


# ---------------------------------------------------------------------------
# Preview tests (JPEG, ≤3840px long edge)
# ---------------------------------------------------------------------------


def test_preview_output_is_jpeg():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert img.format == "JPEG"


def test_preview_long_edge_at_most_3840():
    src = _make_jpeg_with_exif_and_gps(5000, 4000)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert max(img.width, img.height) <= 3840


def test_preview_no_upscale_when_small():
    src = _make_jpeg_with_exif_and_gps(800, 600)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert img.width == 800
    assert img.height == 600


def test_preview_uses_supplied_settings():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_preview(
        src, PreviewSettings(long_edge=700, quality=70)
    )

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    assert max(img.width, img.height) <= 700


def test_preview_no_exif_in_output():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    exif = _pillow_exif(result)
    assert not exif, f"EXIF data found in preview output: {exif}"


def test_preview_no_gps_in_output():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    gps = _pillow_gps_ifd(result)
    assert not gps, f"GPS data found in preview output: {gps}"


def test_preview_is_valid_image():
    src = _make_jpeg_with_exif_and_gps(1000, 800)
    processor = ImageProcessor()
    result = processor.process_preview(src)

    from PIL import Image

    img = Image.open(io.BytesIO(result))
    img.verify()


# ---------------------------------------------------------------------------
# validate_no_forbidden_metadata
# ---------------------------------------------------------------------------


def test_validation_passes_on_clean_output():
    src = _make_jpeg_with_exif_and_gps(400, 300)
    processor = ImageProcessor()
    thumb = processor.process_thumb(src)
    # Must not raise.
    processor.validate_no_forbidden_metadata(thumb)


def test_validation_inspect_bytes_not_just_encoder_options():
    """
    Confirm that metadata inspection reads the actual output bytes.
    A JPEG with an injected EXIF segment must fail validation.
    """
    processor = ImageProcessor()
    metadata_image = _make_jpeg_with_exif_and_gps()
    with pytest.raises(MetadataValidationError):
        processor.validate_no_forbidden_metadata(metadata_image)
