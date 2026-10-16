#!/usr/bin/env bash
set -euo pipefail

# Read-only verification. --refs-only runs before any registry writes.
mode="${1:-}"
if [[ "$#" -gt 1 || ( -n "$mode" && "$mode" != "--refs-only" ) ]]; then
  echo "Usage: RELEASE_SHA=... RELEASE_TAG=vX.Y.Z IMAGE_PREFIX=... bash $0 [--refs-only]" >&2
  exit 1
fi
if [[ ! "${RELEASE_SHA:-}" =~ ^[0-9a-f]{40}$ || ! "${RELEASE_TAG:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected a 40-character RELEASE_SHA and a vX.Y.Z RELEASE_TAG" >&2
  exit 1
fi

# Query the remote: a stale local tag can hide a later history rewrite.
remote_refs="$(git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_TAG}" "refs/tags/${RELEASE_TAG}^{}")"
tag_sha="$(awk '$2 !~ /\^\{\}$/ { direct=$1 } $2 ~ /\^\{\}$/ { peeled=$1 } END { print peeled ? peeled : direct }' <<< "$remote_refs")"
if [[ "$tag_sha" != "$RELEASE_SHA" ]]; then
  echo "Release identity mismatch: ${RELEASE_TAG} now resolves to ${tag_sha}, requested image SHA is ${RELEASE_SHA}." >&2
  echo "A history rewrite does not rewrite GHCR images. Use the original publication evidence; do not rebuild or retag historical images without approval." >&2
  exit 1
fi
[[ "$mode" == "--refs-only" ]] && exit 0
: "${IMAGE_PREFIX:?IMAGE_PREFIX is required}"

rows=""
for name in batch-backend batch-frontend telegram-ops-bot; do
  sha_digest="$(docker buildx imagetools inspect "${IMAGE_PREFIX}/${name}:${RELEASE_SHA}" | awk '$1 == "Digest:" { print $2; exit }')"
  tag_digest="$(docker buildx imagetools inspect "${IMAGE_PREFIX}/${name}:${RELEASE_TAG}" | awk '$1 == "Digest:" { print $2; exit }')"
  if [[ ! "$sha_digest" =~ ^sha256:[0-9a-f]{64}$ || "$sha_digest" != "$tag_digest" ]]; then
    echo "Release image mismatch for ${name}: SHA digest '${sha_digest}', version digest '${tag_digest}'" >&2
    exit 1
  fi
  rows+="| ${name} | ${sha_digest} |"$'\n'
done

# Publish the receipt only after the complete bundle passes.
receipt="$(cat <<EOF
### Verified deployment image bundle

Release tag: ${RELEASE_TAG}
Published release SHA: ${RELEASE_SHA}
Image prefix: ${IMAGE_PREFIX}

| Image | Registry digest |
| --- | --- |
${rows}
Deploy using this published SHA after separate deployment approval. Re-run verification before deployment; tags can change after this receipt.
EOF
)"
printf '%s\n' "$receipt"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$receipt" >> "$GITHUB_STEP_SUMMARY"
fi
