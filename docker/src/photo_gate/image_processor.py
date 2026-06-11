import pyvips

from .models import PreviewSettings, ThumbSettings


class MetadataValidationError(Exception):
    pass


# Core libvips image properties: always present in get_fields() and not
# removable attached metadata.
_CORE_FIELDS = frozenset({
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
})


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

        # Remove all attached metadata (EXIF/XMP/IPTC/ICC, loader info) from
        # the image itself instead of relying on encoder-level strip alone:
        # Debian bookworm's libvips 8.14 (the container base) left EXIF in
        # the saved output, which the fail-closed output validator caught in
        # production and blocked the sync.
        image = image.copy()
        for field in image.get_fields():
            if field not in _CORE_FIELDS:
                image.remove(field)

        if fmt == "webp":
            return image.webpsave_buffer(Q=quality, strip=True)
        if fmt == "jpeg":
            return image.jpegsave_buffer(Q=quality, strip=True, optimize_coding=True)
        raise ValueError(f"Unsupported output format: {fmt!r}")

    def validate_no_forbidden_metadata(self, data: bytes) -> None:
        """
        Fails closed: only core image fields, informational encoder fields,
        and an ICC profile are allowed.
        """
        img: pyvips.Image = pyvips.Image.new_from_buffer(data, "")
        allowed = set(_CORE_FIELDS) | {
            "vips-loader",
            "icc-profile-data",
            # Informational fields set by the libvips JPEG loader (8.16+):
            # chroma subsampling mode and the progressive-scan flag. These
            # describe the encoding itself, carry no EXIF/XMP/IPTC/GPS or
            # other privacy-relevant data, and cannot be stripped because the
            # loader derives them from the mandatory JPEG structure.
            "jpeg-chroma-subsample",
            "jpeg-multiscan",
            # JFIF density unit ("in"/"cm"/"none") set by the JPEG loader
            # from the mandatory APP0 segment the encoder always writes.
            # Encoding information only, no privacy-relevant content.
            "resolution-unit",
        }
        forbidden = sorted(field for field in img.get_fields() if field not in allowed)
        if forbidden:
            raise MetadataValidationError(
                f"Forbidden metadata fields in output image: {forbidden}"
            )
