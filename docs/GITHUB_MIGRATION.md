# GitHub migration record

The canonical active-development repository is
[Kobii-git/homelab-dashboard](https://github.com/Kobii-git/homelab-dashboard), with `main` as its
default branch. The repository was private during migration; source visibility is now an owner
decision separate from this historical record. Hosting public source does not make the application
public; deployment remains private LAN/VPN access.

## Preserved repository data

VERIFIED during the migration:

- Source `main` at `e8014a42ff6a05fd4d5460cfe9ed02cb059a116c` and source `beta` at
  `b45be0fb0d595b73f33837a6e31ef25466583010` are ancestors of the new main history.
- Both source branches were copied without rewriting commits. The active beta branch can advance
  normally from its preserved source commit to the GitHub-ready application.
- All 29 existing project tags match their original GitHub object IDs. Gitea had no additional tags.
- The historical `cursor/split-ssh-rdp-access-pages` branch was also preserved at its original commit.
- The source API returned no issues, pull requests, releases, labels, or milestones. The source wiki
  was uninitialized, and its project-board listing was empty. There was no content in those areas
  to transfer.

The homepage implementation was committed as `0fdd362`; GitHub publication migration started with
`1f6b46f`. The local `origin` now points to GitHub and `main` tracks `origin/main`. The legacy remote
is retained as a historical reference.

## Active publishing

The current tree uses GitHub Actions and GHCR, with Linux AMD64 and ARM64 publication configured.
Legacy registry settings and the old Forgejo workflow have been removed from the current tree.
Authentication, origin restrictions, outbound policy, security scans, and deployment hardening
remain in place. See [GitHub operations](../GITHUB.md) for package authentication, signing identities,
image verification, and migration from `REGISTRY_HOST`/`IMAGE_TAG` to `HOMELAB_IMAGE`.

A branch imported at a historical commit retains that commit's old workflow. Its failed historical
build is not evidence about the new application; use the workflow result attached to the exact new
commit before selecting an image. Never deploy an image merely because a moving tag exists.

## Intentionally retained on Gitea

This cutover covers active development. The legacy container package (`latest` and `beta`, with their
underlying manifests), six historical Actions runs, and source administrative settings remain on
Gitea. Legacy images are not relabeled as newly validated GitHub builds. Webhooks, collaborators,
runner configuration, and credentials are not copied or changed.

The old repository and registry are not deleted or archived. Production containers, databases,
secrets, network settings, and deployment hosts are untouched. Operators can keep using the old
images for recovery until a separately authorized application upgrade is validated.
