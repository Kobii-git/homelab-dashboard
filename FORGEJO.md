# Forgejo Operations

This project is maintained in a private Forgejo instance. Git access must use the
operator-configured SSH endpoint; the Forgejo UI and container registry must use trusted
HTTPS. Plaintext HTTP Git and registry endpoints are unsupported.

## Branches

- `main`: stable channel; publishes `latest` and `main` images.
- `beta`: pre-release channel; publishes the `beta` image.

Both branches are permanent and must be kept available. Changes should be tested on `beta` before being promoted to `main`.

## Container images

The Forgejo Container Registry image is:

`${REGISTRY_HOST}/kobuslabs/homelabdashboard`

Authenticate with a Forgejo personal access token before pulling private images:

```sh
test -n "${REGISTRY_HOST}"
docker login "${REGISTRY_HOST}"
docker pull "${REGISTRY_HOST}/kobuslabs/homelabdashboard:latest"
docker pull "${REGISTRY_HOST}/kobuslabs/homelabdashboard:beta"
```

The Compose file uses `latest` by default. To select beta:

```sh
IMAGE_TAG=beta docker compose pull
IMAGE_TAG=beta docker compose up -d --force-recreate
```

Every branch build also receives a short immutable `sha-*` tag. Version tags (`vMAJOR.MINOR.PATCH`) receive semver tags.

## Actions

The canonical Forgejo workflow is `.forgejo/workflows/docker.yml`. It runs typecheck, unit
tests, build, browser/accessibility tests, dependency audits, Gitleaks, Trivy filesystem,
Dockerfile, SBOM, local-image and pushed-digest scans, ZAP baselines, startup smoke checks,
and a non-root read-only container smoke test before publishing images.

Forgejo Actions requires a Docker-capable runner. Configure the `REGISTRY_HOST` repository
variable plus `FORGEJO_TOKEN`, `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`, and
`COSIGN_PUBLIC_KEY` secrets. Install the registry CA on the runner and Docker host when a
private CA is used. The GitHub-compatible mirror is retained at `.github/workflows/docker.yml`.

The workflow performs a trusted HTTPS `/v2/` preflight before registry login or push, embeds
SBOM/provenance attestations, scans the pushed digest, and signs and verifies that digest
with Cosign. Do not configure Docker `insecure-registries`.

## Updating the repository

```sh
git remote set-url origin git@forgejo.home.arpa:kobuslabs/homelabdashboard.git
git fetch origin
git push origin main
git push origin beta
```

Replace `forgejo.home.arpa` with the operator-owned SSH hostname. Verify SSH key access before
removing any working migration fallback, then rotate the token previously used over HTTP.

Do not commit `.env`, SQLite databases, `node_modules`, `dist`, or test artifacts; these are intentionally ignored.
