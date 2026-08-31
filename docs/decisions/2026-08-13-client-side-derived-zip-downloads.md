# Client-Side Derived ZIP Downloads

Date: 2026-08-13

Status: Accepted

## Context

The album grid already supports selecting generated `thumb` WebP or `preview`
JPEG derivatives. The no-JavaScript flow posts the selection to the Worker,
which validates it against the current manifest and returns individual
attachment links. Users also need one explicit action that saves the selected
derived files as one archive.

Creating ZIP archives in a Worker would add CPU, memory, and multiple R2 reads
to an edge request. That conflicts with the project goal of keeping the
Cloudflare Workers free tier lightweight. Sending archive work to Docker would
make a viewer interaction depend on the Raspberry Pi and add a new asynchronous
control protocol.

## Decision

Use a versioned, same-origin browser module only on an album detail page where
downloads are enabled.

1. The viewer explicitly clicks `まとめて保存 (ZIP)` after selecting photos.
2. The browser requests the existing authenticated `/download/:albumId/thumb/:photoId`
   or `/download/:albumId/preview/:photoId` routes sequentially.
3. The browser creates a ZIP with the ZIP `store` method (no compression) and
   saves one `photo-gate-download.zip` file.

The module is progressive enhancement. JavaScript-disabled browsers retain the
existing `POST /download/:albumId/selection` page of individual links.

## Bounds

- At most 20 selected files in one browser ZIP.
- At most 25 MiB for one fetched derivative.
- At most 100 MiB across the archive.
- Files are fetched sequentially, not in parallel.
- ZIP filenames come from the already-sanitized attachment header, with a
  deterministic flat ordinal fallback and duplicate-name disambiguation.
- The ZIP stores files without recompression because WebP and JPEG are already
  compressed. ZIP entry timestamps are fixed to the ZIP epoch rather than
  adding a download-time signal.

On a size, session, authorization, membership, or network failure, the browser
shows a generic failure and preserves the existing link-list alternative. No
server error text, object key, source path, or credential is reflected.

## Security And Boundary Effects

The browser never receives a direct R2 URL, signed URL, NAS path, PhotoPrism
URL, RAW/original, or source metadata. Each fetch follows the existing Worker
authorization chain: session, album permission, `download_enabled`, validated
manifest membership, and fixed generated-object key. The Worker adds no ZIP
route, image processing, R2 list/mutation, Docker call, D1 schema change, or
new secret/binding.

This choice keeps the added CPU work on the requesting device. It does increase
the number of normal download requests by the number of selected files; the
strict browser bounds and sequential fetches keep that load predictable.
