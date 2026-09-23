---
name: release-flow
description: Mandatory end-to-end workflow for shipping a version of emu8086web — feature branch, PR, review, merge gate, tag, GitHub Release, and per-version efficiency audit versus the previous version only.
---

Follow this instrument on every versioned change. Do not skip steps. The order is fixed.

## 1. Branch

- Branch from up-to-date `main`: `feature/<slug>-vX.Y.Z` (features) or `chore/<slug>` (process-only, no version bump).
- One version bump per release branch.

## 2. Implement with continuous tests

- Every new pure function ships with `node:test`-style unit tests in the same directory (`bun test lib electron` must stay green).
- Test files use `import ... from "node:test"` + `node:assert/strict` (never `bun:test` — it breaks `typecheck`).
- UI behavior that unit tests can't cover gets a live browser check on the dev server before review.

## 3. Version + changelog + audit (before the PR is done)

- Bump `package.json`, `lib/version.ts`, `lib/changelog.ts`, `CHANGELOG.md` (add a `## [X.Y.Z]` section).
- Write `audit/vX.Y.Z.md`: measured numbers (median of 3 runs, record machine + bun version) and a **vs-previous-version-only** comparison. See `audit/README.md` for the frozen benchmark workload.
- All checks green: `bun run lint`, `bun run typecheck`, `bun test lib electron`, `bun run build` (enforced by git hooks, but verify).

## 4. Pull request

- Push the branch, open the PR against `main` with summary / manual test plan / notes, and register it with the thread's PR-linking tool.
- Post a self-review comment: correctness findings, check results, known minors, explicit do-not-merge notice.

## 5. Merge gate (hard rule)

- **Never merge before the user's explicit manual-verification approval**, even if CI is green.
- Merge only with: green CI + user approval. Merge with `gh pr merge --merge`, delete the branch, update local `main`.

## 6. Release (auto, with manual fallback)

- Merging a version bump to `main` triggers `.github/workflows/release.yml`, which tags `vX.Y.Z` and creates the GitHub Release with CHANGELOG notes. `release-desktop.yml` then attaches macOS installers to the same release.
- If automation is absent or missed a version: `git tag -a vX.Y.Z <merge-sha> && git push origin vX.Y.Z && gh release create vX.Y.Z --title vX.Y.Z --notes-file <section>`.
- Never retag a published version; never force-push tags.

## 7. Regression tracking

- The audit of version N+1 always compares against version N only. If throughput drops >15 % or a memory bound grows, flag it in the PR body and fix before merge.
