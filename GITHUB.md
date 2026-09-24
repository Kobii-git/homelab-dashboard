# GitHub operations

## Canonical repository and history

[Kobii-git/homelab-dashboard](https://github.com/Kobii-git/homelab-dashboard) is the
canonical private repository. Clone using authenticated HTTPS or SSH:

```sh
git clone https://github.com/Kobii-git/homelab-dashboard.git
cd homelab-dashboard
```

`main` contains the current application and publishes the stable image channel. `beta` is retained
as the prerelease branch. Historical branches and tags keep their original commits; merely importing
an old branch does not modernize its workflow or publish a new image. Promote changes through normal
merges after validation. Never force-push migrated history or overwrite existing tags.

The former Gitea/Forgejo workflow and insecure registry builder configuration have been retired from
the current tree. The source repository can remain available for historical audit until its owner
has checked administrative metadata and completed cutover. Do not remove a working deployment or its
data volume as part of changing Git hosting.

## GitHub Actions and private images

`.github/workflows/docker.yml` is the canonical publication pipeline. Pushes to `main`, `beta`, and
`v*` tags run the existing validation and security gates before publication. Actions and scanner
images remain pinned. The workflow uses `GITHUB_TOKEN` with package-write permission; no old registry
password or signing private key is needed. OIDC requires `id-token: write`.

Images are published to `ghcr.io/kobii-git/homelab-dashboard`:

- `main` publishes `latest` and `main`.
- `beta` publishes `beta` after its workflow is updated and passes.
- Release tags publish semantic-version tags; builds also publish `sha-*` references.
- Production deployments should use the verified `sha256` digest, rather than a moving tag.

Keep both the repository and GHCR package private. Verify package visibility and repository access
in GitHub after the first successful publication. Newly created container packages default to private.
If an existing package is not connected to this repository, its owner must grant the repository
Actions access before the job can publish.

Deployment hosts need authenticated package-read access. Use a GitHub personal access token (classic)
with `read:packages`, limited to an account authorized for this private package. Enter it at Docker's
password prompt; do not put tokens in Compose, Git, shell command arguments, or documentation:

```sh
docker login ghcr.io --username YOUR_GITHUB_USERNAME
```

See [GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
for package access and credential requirements.

## Verify before deploying

The workflow signs the pushed digest using its GitHub OIDC identity and verifies the signature before
reporting success. Sigstore's public transparency log records signing metadata, including repository,
workflow identity, and image digest. It does not receive application databases or configuration.

Authenticate to GHCR, obtain the digest from a successful run, and verify it with Cosign:

```sh
IMAGE='ghcr.io/kobii-git/homelab-dashboard@sha256:REPLACE_WITH_VERIFIED_DIGEST'
cosign verify \
  --certificate-identity 'https://github.com/Kobii-git/homelab-dashboard/.github/workflows/docker.yml@refs/heads/main' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "$IMAGE"
```

For an intentionally selected beta or release build, use its exact `refs/heads/beta` or `refs/tags/v...`
identity. Do not broaden verification to arbitrary identities. See [Sigstore's CI guide](https://docs.sigstore.dev/quickstart/quickstart-ci/).

Set `HOMELAB_IMAGE` to that verified digest in the deployment environment. `REGISTRY_HOST` and
`IMAGE_TAG` are no longer Compose inputs. Back up the database and assets before changing the running
image, then follow [secure deployment](docs/SECURE_DEPLOYMENT.md) and
[backup and recovery](docs/BACKUP_AND_RESTORE.md). Repository migration does not deploy the application.
LAN/VPN-only HTTPS, sign-in, proxy restrictions, and public-status defaults are unchanged.

## Remaining source administration

Git history does not contain repository permissions, webhooks, runner settings, registry contents,
Actions logs, or secrets. Review those separately with a source administrator. Do not copy legacy
credentials into GitHub; replace only still-needed integrations with scoped credentials. Avoid
recreating webhooks that would publish twice or expose the private application.

Keep old image digests available for rollback until a new GitHub build has passed all gates and an
operator has validated the replacement deployment. Historical CI logs are archival evidence, not
GitHub Actions runs, and should not be replayed as releases.
