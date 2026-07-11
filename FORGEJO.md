# Forgejo Operations

This project is maintained in the private Forgejo instance at:

`http://10.0.21.40:3000/kobuslabs/homelabdashboard`

## Branches

- `main`: stable channel; publishes `latest` and `main` images.
- `beta`: pre-release channel; publishes the `beta` image.

Both branches are permanent and must be kept available. Changes should be tested on `beta` before being promoted to `main`.

## Container images

The Forgejo Container Registry image is:

`10.0.21.40:3000/kobuslabs/homelabdashboard`

Authenticate with a Forgejo personal access token before pulling private images:

```sh
docker login 10.0.21.40:3000
docker pull 10.0.21.40:3000/kobuslabs/homelabdashboard:latest
docker pull 10.0.21.40:3000/kobuslabs/homelabdashboard:beta
```

The Compose file uses `latest` by default. To select beta:

```sh
IMAGE_TAG=beta docker compose pull
IMAGE_TAG=beta docker compose up -d --force-recreate
```

Every branch build also receives a short immutable `sha-*` tag. Version tags (`vMAJOR.MINOR.PATCH`) receive semver tags.

## Actions

The canonical Forgejo workflow is `.forgejo/workflows/docker.yml`. It runs typecheck, unit tests, build, browser/accessibility tests, dependency audits, startup smoke checks, and a non-root read-only container smoke test before publishing images.

Forgejo Actions requires a Docker-capable runner. The workflow uses the automatic `FORGEJO_TOKEN`/`GITHUB_TOKEN` repository token for registry authentication. The GitHub-compatible mirror is retained at `.github/workflows/docker.yml`.

The current registry endpoint is plain HTTP on the private LAN. Configure the runner's Docker daemon with `10.0.21.40:3000` in `insecure-registries`, or put the Forgejo registry behind HTTPS before enabling automated image publishing on a runner.

## Updating the repository

```sh
git remote set-url origin http://10.0.21.40:3000/kobuslabs/homelabdashboard.git
git fetch origin
git push origin main
git push origin beta
```

Do not commit `.env`, SQLite databases, `node_modules`, `dist`, or test artifacts; these are intentionally ignored.
