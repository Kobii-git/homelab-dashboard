# Public release readiness

Review date: 2026-09-24. Baseline: `8a520de`. The owner requested an open-source/privacy review,
then explicitly chose to leave the GitHub repository public while cleanup is prepared. Repository
visibility is separate from private LAN/VPN application deployment.

**Status: source cleanup prepared; historical privacy cleanup and release gates remain.**
Do not describe this as a guarantee that all personal information has been removed.

## Completed preparation

- Added the MIT license already advertised by the README, package metadata, contributor/support and
  conduct guidance, private-reporting instructions, and a privacy/data-flow inventory.
- Generated full notices for 119 locked production dependencies; added a reproducibility check,
  browser Credits link and image license files. Original third-party attributions are retained.
- Added Open-Meteo/CC BY attribution beside weather, including rounding/summarization disclosure.
- Removed the personal security contact from the current tree and replaced deployment-specific
  network examples. Synthetic test credentials, documentation placeholders and fictional demo data
  remain deliberately identifiable as examples; they are not production secrets.
- Broadened Git/build-context exclusions for environment variants, databases, keys, logs and backups.
- Added read-only fork PR validation, disabled persisted checkout credentials, separated validation
  from publication permissions, and retained scanning/SBOM/signing gates. Minimal provenance retains
  source/material identity without rich environment metadata; build-record uploads are disabled.
- Corrected local source-build Compose to inherit production origin/proxy, storage and hardening.
- Fixed four source-reviewed security issues: final credential-recipient origin validation (including
  Plex posters), shared account-wide password-confirmation throttling, target-excluded AI diagnostics,
  and actual ZIP structure/size/checksum enforcement. Existing v1 exports still restore; externally
  recompressed ZIPs are now rejected. No database schema or production data was changed.

## Verified validation

- `HOMEPAGE_CROSS_BROWSER=1 HOMEPAGE_EDGE=1 npm run validate`: 84 server tests and 104 browser tests
  passed across Chromium, Edge, Firefox and WebKit; typecheck/build/notices checks passed; both npm
  audits reported zero vulnerabilities. WebKit keyboard attribution navigation was fixed and rerun.
- Before committing cleanup, type checks and all 85 server tests passed on the combined source after
  the separate private-HTTP commit. This does not replace a security review of that deployment mode.
- `npm ci` followed by `npm run licenses:check` passed in a disposable source copy.
- `actionlint .github/workflows/docker.yml .github/workflows/pull-request.yml` and `git diff --check` passed.
- Merged Compose was checked using synthetic environment values, without reading operator `.env`.
- Local ARM64 Docker image built; disposable non-root/read-only/no-network smoke verified production
  sign-in, Secure/HttpOnly cookies, private API/status responses and bundled license notices.
- Trivy filesystem/dependency/configuration and local runtime-image scans found no HIGH/CRITICAL
  vulnerabilities, secrets or misconfigurations at their configured gates. These are point-in-time
  results, not a certification or a substitute for the exact release's CI results.
- Gitleaks reported no secrets in reachable Git history, the current source snapshot, or retained
  CI material. Automated detectors cannot prove absence of all secrets.
- The static code review covered all 129 baseline tracked files. The separate Docker installer and
  overlapping documentation edits introduced by another task were preserved; they are not part of
  that immutable baseline scan. Later private-HTTP installer/runtime changes are also outside this
  completed review and its validation snapshot. In particular, the HTTPS container smoke does not
  validate the subsequent HTTP deployment mode. Review and validate the final combined release.

## Outstanding release decisions and checks

1. **Historical personal data:** reachable commits still contain personal contact metadata and old
   deployment references. All 61 inspected commits had non-noreply author/committer metadata. Ordinary
   commits deleting current text do not erase these copies. Choose either a clean public source
   snapshot with the original repository retained privately, or a separately approved all-ref history
   sanitization. The latter changes commit/tag identities and requires coordination with every clone.
   No history rewrite, tag deletion, force push or repository replacement was performed.
2. **GitHub copies:** 84 Actions runs and 77 artifact records were inventoried. Nine runs had downloadable
   logs and two build artifacts remained available; they were scanned. Both latest runs/build records
   contain commit contact details. Expired/unavailable material could not be inspected. After approval,
   remove the affected retained runs/artifacts and inspect any associated image attestations. Existing
   forks, caches and downloaded copies cannot be recalled by a Git push.
3. **Asset rights:** confirm or replace `public/tmdb-logo.svg` with an approved TMDB logo. The original
   source provenance was not recorded. The official attribution page provides approved assets, but
   direct retrieval returned HTTP 403 during review; no provenance claim was fabricated. Confirm rights
   to all project contributions before applying the MIT grant to a public release. Provider API/data
   terms and trademark rights remain separate; see `THIRD_PARTY_NOTICES.md`.
4. **Repository administration:** enable and test private vulnerability reporting (observed disabled),
   require reviewed passing PRs for `main`/`beta`, protect release tags, restrict Actions permissions and
   approve external-contributor workflow runs deliberately. Set future author/committer identities to
   the intended public name and GitHub-provided noreply address; `.mailmap` does not erase history.
5. **Release verification:** committing source cleanup does not complete publication validation. Run
   the amended GitHub workflow on the exact release commit. The latest baseline workflows stopped before
   signing because Docker could not pull two platforms under one local digest. The local workflow
   correction scans each platform directly from the registry; it still needs a real CI run. Do not
   treat an existing moving image tag as a successfully scanned/signed release.
6. **Operator checks:** actual Safari/Brave, live LAN/VPN HTTPS, DNS renewal and production recovery
   remain separate operator validation. No production secrets, database, network configuration or
   running deployment was accessed or changed for this review.

## Cleanup choices

A clean public snapshot is the simplest way to avoid republishing historical personal material while
preserving the original history privately. It needs an explicit repository/name/migration decision;
it is not equivalent to committing deletions on the existing `main` branch.

Keeping the existing public history requires a reviewed replacement mapping for historical files and
commit identities, a private recovery copy, temporary coordination of writes, replacement of all
relevant branches/tags, remote cache/ref follow-up and fresh clones. This is a destructive history
operation and remains outside the current authorization. Approval to leave the repository public
is not approval to rewrite its history or delete its Actions records.

See GitHub's [sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
and [visibility implications](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
