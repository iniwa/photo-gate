# Engineering Rules

## Change Discipline

- Read the codebase before designing a replacement.
- Prefer existing patterns and focused changes.
- Keep one logical change per commit.
- Do not mix unrelated refactors with feature work.
- Preserve compatibility unless an explicit documented migration exists.
- Update relevant documentation with behavior changes.

## Security

- Treat request data, D1 rows, manifests, object metadata, environment values,
  and external API responses as untrusted.
- Validate at each trust boundary and fail closed.
- Parameterize SQL and reconstruct minimal response objects.
- Never forward R2 metadata or caller-supplied content types/headers.
- Never log passwords, tokens, cookies, digests, credentials, object contents,
  private IDs/keys, SQL parameters, or secret values.
- Keep generic sanitized external errors and useful non-sensitive internal
  operational signals.

## Workers

- Keep Hono + JSX SSR unless an ADR justifies a change.
- Every real data route must compose authentication and authorization explicitly.
- Every photo route must confirm exact membership in the current validated
  manifest before reading its object.
- Keep authenticated HTML and objects out of shared caches.
- Use fixed allowlisted response content types and headers.
- Use `DB` and `PHOTO_BUCKET` as production binding names.

## Docker

- Use PhotoPrism generated previews as the normal image source.
- Re-encode every image and validate forbidden metadata removal before upload.
- Keep memory use suitable for Raspberry Pi 4 and stream where practical.
- Upload referenced images before the manifest.
- Require explicit confirmation for upload-capable commands.
- Keep deletion dry-run only.
- Maintain `linux/amd64` and `linux/arm64` compatibility.

## Tests And Review

- Test behavior, not only source strings.
- Add focused regression tests for every bug.
- Prioritize tests around authentication, authorization, manifest integrity,
  key validation, metadata removal, upload ordering, and destructive safeguards.
- Before commit, self-review for security regressions, missing failure paths,
  leaked details, route exposure, and documentation drift.
- Run the full affected component suite before push/deploy.

## Git And Delivery

- Keep `main` deployable.
- Do not force-push, rewrite published history, or replace existing tags.
- Gitea is canonical; GitHub is the mirror and CI/CD platform.
- Use immutable Docker release tags and record deployed versions.
- Use least-privilege GitHub Actions permissions and pin action major versions
  at minimum; prefer immutable references when practical.
- Do not consume untrusted issue/PR text as executable agent or shell input.

## Documentation

- `docs/fable/current-state.md`, `roadmap.md`, and `progress.md` describe current
  operational truth and must stay current.
- `docs/decisions/` records durable design decisions and rationale.
- `docs/handoffs/archive/` records completed implementation history.
- Do not duplicate detailed rules across many files when a link is sufficient.
