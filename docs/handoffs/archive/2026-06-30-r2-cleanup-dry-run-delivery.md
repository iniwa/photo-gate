Read AGENTS.md, CLAUDE.md, and this handoff file before implementation.
If implementation would violate constraints or require files outside this
handoff, stop and ask before editing.

## Goal

Deliver the reviewed R2 cleanup dry-run report to production and record the
delivery state.

The implementation commit is already present locally:

- `b3c434c feat: add admin r2 cleanup dry-run report`

This handoff covers push, CI/deploy observation, smoke checks, and documentation
updates only. It does not authorize any R2 deletion or new feature work.

## Background

The accepted ADR is:

- `docs/decisions/2026-06-30-r2-cleanup-dry-run.md`

The reviewed and archived implementation handoff is:

- `docs/handoffs/archive/2026-06-30-r2-cleanup-dry-run-report.md`

The implementation adds:

- `GET /admin/r2-cleanup`;
- a read-only Worker repository that lists only private R2 `albums/` and `ops/`;
- D1 read-only album ownership lookup using only `id` and `enabled`;
- a dry-run HTML report with no object body reads and no mutation forms.

Codex review found one issue in the `ops/` truncation path; Claude Code fixed
it, added a regression test, and Codex reviewed the fix. The implementation was
then committed as `b3c434c`.

## Acceptance Criteria

1. Confirm the worktree is clean except for unrelated `docs/iniwa-issues.md`.
2. Push `main` to the canonical remote after confirming the latest local commit
   is `b3c434c`.
3. Confirm the GitHub mirror sees `b3c434c` or that the mirror-triggered CI is
   running for that commit.
4. Confirm Workers CI passes for `b3c434c`.
5. If CI performs the normal Workers deployment automatically, record the new
   Worker version ID and commit in docs.
6. Do not run `npx wrangler deploy` manually unless Codex/operator gives
   separate explicit approval after CI observation.
7. Run unauthenticated production smoke checks against
   `https://share-photo.iniwach.com`:
   - `GET /` returns the viewer login page (`200`);
   - unauthenticated `GET /albums` redirects to `/`;
   - unauthenticated `GET /img/probe-nonexistent` returns `401` and
     `Cache-Control: no-store`;
   - unauthenticated `GET /api/probe` returns `401` and
     `Cache-Control: no-store`;
   - unauthenticated `GET /admin` is intercepted by Cloudflare Access;
   - unauthenticated `GET /admin/r2-cleanup` is intercepted by Cloudflare Access
     or otherwise fails closed before the Worker report is exposed.
8. Ask the operator to confirm in an authenticated browser session:
   - `/admin` contains the R2 cleanup report link;
   - `/admin/r2-cleanup` renders the dry-run report;
   - the page has no delete button/form and is clearly read-only;
   - no full R2 object keys, photo IDs, bucket name, PhotoPrism UID/URL/token,
     or credentials are visible.
9. Update delivery documentation only after the deployment state is known:
   - `docs/operations/deploy-log.md`;
   - `docs/fable/current-state.md`;
   - `docs/fable/progress.md`.
10. If authenticated browser confirmation is not available during this handoff,
    record it as pending in the report and do not mark production smoke fully
    complete.
11. Do not change implementation code unless a deployment blocker is discovered.
    If code changes are required, stop and ask before editing.

## Files To Inspect

- `AGENTS.md`
- `CLAUDE.md`
- `FABLE.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`
- `docs/fable/roadmap.md`
- `docs/operations/deploy-log.md`
- `docs/handoffs/archive/2026-06-30-r2-cleanup-dry-run-report.md`
- `workers/src/routes/admin.tsx`
- `workers/src/services/admin-r2-cleanup-repository.ts`
- `workers/README.md`

## Files To Edit

Edit only after delivery status is known:

- `docs/operations/deploy-log.md`
- `docs/fable/current-state.md`
- `docs/fable/progress.md`

Optional only if roadmap status must be corrected to match the delivery:

- `docs/fable/roadmap.md`

Do not edit:

- `workers/`
- `workers/migrations/`
- `docker/`
- `docs/decisions/`
- `docs/handoffs/archive/`
- `.github/`
- `docs/iniwa-issues.md`

## Constraints

- Preserve every non-negotiable invariant in `AGENTS.md`.
- R2 deletion remains disabled.
- Do not add or expose any R2 mutation operation.
- Do not run any R2 delete, object rewrite, bucket policy change, public access
  change, signed URL creation, D1 mutation, migration, Docker release, or
  Portainer update.
- Do not manually deploy with Wrangler unless separately approved.
- Do not print secrets, Worker environment values, Cloudflare Access claims,
  bucket names from errors, tokens, or credentials.
- Production smoke must not require an authenticated token in CLI output.
- Keep `docs/iniwa-issues.md` unmodified, unstaged, and uncommitted.
- If CI/deploy fails, collect sanitized status and stop with a blocker report.

## Non Goals

- No R2 deletion.
- No R2 cleanup execution beyond read-only reporting.
- No hard delete design.
- No album/user deletion implementation.
- No Worker code changes.
- No Docker changes.
- No D1 migrations.
- No Portainer changes.
- No dependency updates.

## Verification

Before push:

```powershell
git status --short
git log -1 --oneline
git diff --check
git diff HEAD -- workers/
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
```

Delivery / CI observation:

```powershell
git push origin main
git status --short
git log -1 --oneline
```

Use the available GitHub/Gitea/CI tooling to confirm that `b3c434c` is mirrored
and Workers CI passed. Do not expose secrets while checking.

Unauthenticated production smoke may use `curl.exe` or equivalent safe HTTP
checks. Record status codes, redirect locations, and relevant `Cache-Control`
headers only.

After documentation edits:

```powershell
git diff --check
git diff HEAD -- workers/
git diff HEAD -- docker/
git diff HEAD -- workers/migrations/
git status --short
```

Do not run Docker tests. No Docker files should change.

## Expected Report

Report in Japanese.

Include:

1. Execution phase summary.
2. Commit pushed:
   - commit hash;
   - commit subject;
   - remote pushed.
3. CI / deployment status:
   - GitHub mirror status;
   - Workers CI result;
   - deployed Worker version ID if deployment happened;
   - whether manual Wrangler deploy was skipped.
4. Production smoke results:
   - unauthenticated checks with status/header summary;
   - authenticated browser checks, or explicit pending status if operator action
     is still required.
5. Documentation changes:
   - exact files edited;
   - what was recorded.
6. Confirmation that no code, migrations, Docker files, R2/D1 data, Portainer
   stack, secrets, or public access settings were changed by this handoff.
7. Verification command results.
8. Skipped checks with exact reasons.
9. `docs/iniwa-issues.md` remained unmodified, unstaged, and uncommitted.
10. Blockers or Codex/operator questions. If none, say none.
