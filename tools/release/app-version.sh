#!/usr/bin/env bash
# Print the app version name for the checked-out commit: 1.2.<commit count>.
# The count is the number of commits in HEAD's history, so the same master
# commit gets the same version on iOS and Android, and every new master commit
# gets a higher one. Refuses shallow clones and commits that are not on master.
set -euo pipefail

VERSION_PREFIX="1.2"
MASTER_REF="refs/remotes/origin/master"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "app-version: shallow clone; the commit count would be wrong. Fetch full history (actions/checkout fetch-depth: 0, or git fetch --unshallow)." >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "$MASTER_REF" > /dev/null; then
  git fetch --quiet origin "+refs/heads/master:${MASTER_REF}"
fi

if ! git merge-base --is-ancestor HEAD "$MASTER_REF"; then
  echo "app-version: HEAD ($(git rev-parse --short HEAD)) is not on origin/master. Version names come only from master commits." >&2
  exit 1
fi

printf '%s.%s\n' "$VERSION_PREFIX" "$(git rev-list --count HEAD)"
