import pyvips

from .models import PreviewSettings, ThumbSettings


class MetadataValidationError(Exception):
    pass


class ImageProcessor:
    def process_thumb(self, data: bytes, settings: ThumbSettings | None = None) -> bytes:
        """Re-encode to WebP ≤640px long edge, strip metadata. Never upscales."""
        settings = settings or ThumbSettings()
        return self._process(
            data,
            long_edge=settings.long_edge,
            fmt=settings.format,
            quality=settings.quality,
        )

    def process_preview(
        self, data: bytes, settings: PreviewSettings | None = None
    ) -> bytes:
        """Re-encode to JPEG ≤3840px long edge, strip metadata. Never upscales."""
        settings = settings or PreviewSettings()
        return self._process(
            data,
            long_edge=settings.long_edge,
            fmt="jpeg",
            quality=settings.quality,
        )

    def _process(
        self, data: bytes, long_edge: int, fmt: str, quality: int
    ) -> bytes:
        image: pyvips.Image = pyvips.Image.new_from_buffer(data, "")

        # Apply correct orientation from EXIF before stripping metadata.
        image = image.autorot()

        current_long = max(image.width, image.height)
        if current_long > long_edge:
            image = image.resize(long_edge / current_long)

        if fmt == "webp":
            return image.webpsave_buffer(Q=quality, strip=True)
        if fmt == "jpeg":
            return image.jpegsave_buffer(Q=quality, strip=True, optimize_coding=True)
        raise ValueError(f"Unsupported output format: {fmt!r}")

    def validate_no_forbidden_metadata(self, data: bytes) -> None:
        """
        Fails closed: only core image fields and an ICC profile are allowed.
        """
        img: pyvips.Image = pyvips.Image.new_from_buffer(data, "")
        allowed = {
            "width",
            "height",
            "bands",
            "format",
            "coding",
            "interpretation",
            "xoffset",
            "yoffset",
            "xres",
            "yres",
            "filename",
            "vips-loader",
            "icc-profile-data",
        }
        forbidden = sorted(field for field in img.get_fields() if field not in allowed)
        if forbidden:
            raise MetadataValidationError(
                f"Forbidden metadata fields in output image: {forbidden}"
            )
