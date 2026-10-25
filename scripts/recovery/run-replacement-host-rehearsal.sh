#!/usr/bin/env bash
# Owns only newly allocated local Docker resources. Never accepts a host/SSH/cloud target.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
case "${1:-}" in
  --dry-run) echo 'Disposable Ubuntu 24.04 source -> backup bundle -> destroy source -> clean Ubuntu replacement -> bootstrap/restore/pinned deploy/verify. Local Docker socket only; no SSH, VPS, DNS or production inputs.'; exit 0 ;;
  '') ;;
  *) echo 'Usage: bash scripts/recovery/run-replacement-host-rehearsal.sh [--dry-run]' >&2; exit 1 ;;
esac
revision="${ESL_REHEARSAL_REVISION:-$(git -C "$ROOT_DIR" rev-parse origin/main)}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full pinned Git SHA required' >&2; exit 1; }
git -C "$ROOT_DIR" cat-file -e "$revision^{commit}"
work="$(mktemp -d /tmp/esl-recovery.XXXXXXXX)"
run_id="$(basename "$work" | tr '[:upper:]' '[:lower:]')"
evidence="${ESL_REHEARSAL_EVIDENCE_DIR:-$work/evidence}"
# Refuse existing evidence, including symlinks; never overwrite operator-owned artifacts.
[[ ! -e "$evidence" && ! -L "$evidence" ]] || { echo 'Evidence directory must be new' >&2; exit 1; }
[[ "$evidence" == /* ]] || { echo 'Evidence directory must be absolute' >&2; exit 1; }
mkdir -p "$(dirname "$evidence")"
mkdir -m 0700 "$evidence"
printf 'Evidence: %s\nPinned application: %s\n' "$evidence" "$revision"
container=''
volume=''
containerd_volume=''
builder="$run_id-build"
builder_created=false
created_images=()
host_image="$run_id-host:rehearsal"
backend="$run_id/batch-backend:$revision"
frontend="$run_id/batch-frontend:$revision"
cleanup_host() {
  if [[ -n "$container" ]]; then
    docker cp "$container:/evidence/." "$evidence/" 2>/dev/null || true
    docker logs "$container" > "$evidence/host-console-$phase.log" 2>&1 || true
    if docker rm -f "$container" >/dev/null 2>&1; then container=''; fi
  fi
  if [[ -n "$volume" ]]; then
    if [[ "$(docker volume inspect "$volume" --format '{{index .Labels "esl.rehearsal"}}' 2>/dev/null)" == "$run_id" ]]; then
      if docker volume rm "$volume" >/dev/null 2>&1; then volume=''; fi
    fi
  fi
  if [[ -n "$containerd_volume" ]]; then
    if [[ "$(docker volume inspect "$containerd_volume" --format '{{index .Labels "esl.rehearsal"}}' 2>/dev/null)" == "$run_id" ]]; then
      if docker volume rm "$containerd_volume" >/dev/null 2>&1; then containerd_volume=''; fi
    fi
  fi
}
cleanup() {
  local rc=$?
  # Cleanup must run to completion even when an individual Docker operation fails.
  set +e
  cleanup_host
  if [[ "$builder_created" == true ]] && docker buildx rm "$builder" >/dev/null 2>&1; then builder_created=false; fi
  local image cleanup_ok=true
  [[ -z "$container" && -z "$volume" && -z "$containerd_volume" && "$builder_created" == false ]] || cleanup_ok=false
  for image in "${created_images[@]}"; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      docker image rm "$image" >/dev/null 2>&1 || cleanup_ok=false
    fi
  done
  # Evidence is retained even on failure. Source/build staging belongs to this allocation.
  rm -rf "$work/source" "$work/host" "$work/images.tar" "$work/repository.tar" "$work/tooling.tar" "$work/bundle" || cleanup_ok=false
  rm -f "$work/buildkitd.toml" "$work/"*.Dockerfile || cleanup_ok=false
  printf '{"allocatedResourcesRemoved":%s,"originalExitCode":%s}\n' "$cleanup_ok" "$rc" > "$evidence/cleanup.json" || cleanup_ok=false
  if [[ "$cleanup_ok" != true ]]; then
    echo 'Invocation-owned resource cleanup failed; inspect cleanup.json and Docker resources' >&2
    rc=1
  fi
  printf 'Rehearsal exit=%s; retained evidence: %s\n' "$rc" "$evidence"
  exit "$rc"
}
phase=build
trap cleanup EXIT
mkdir "$work/source" "$work/host"
# Git's default tar.umask can leave archived privileged code group-writable. Match the
# production checkout trust contract before bootstrap/backup/deployment reads any scripts.
git -C "$ROOT_DIR" -c tar.umask=0022 archive "$revision" > "$work/repository.tar"
tar -xf "$work/repository.tar" -C "$work/source"
# A dedicated builder owns its cache; remove it before guest image loads on small Cloud disks.
# Native snapshotting works on nested filesystems without relying on an overlay-on-overlay mount.
builder_args=(--name "$builder" --driver docker-container --buildkitd-flags '--oci-worker-snapshotter=native')
if [[ -n "${HTTP_PROXY:-}" ]]; then
  # Managed Cloud proxy transport is host-local; keep registry requests on that transport.
  # This is the build daemon only, outside either recovery guest or application network.
  builder_args+=(--driver-opt network=host)
  resolve_proxy() {
    python3 - "$1" <<'PYPROXY'
import socket, sys
from urllib.parse import urlparse, urlunparse
url = urlparse(sys.argv[1])
if url.scheme == 'http' and url.hostname == 'proxy':
    url = url._replace(netloc=url.netloc.replace('proxy', socket.gethostbyname('proxy')))
print(urlunparse(url))
PYPROXY
  }
  builder_args+=(--driver-opt "env.HTTP_PROXY=$(resolve_proxy "$HTTP_PROXY")" --driver-opt "env.HTTPS_PROXY=$(resolve_proxy "${HTTPS_PROXY:-$HTTP_PROXY}")" --driver-opt "\"env.NO_PROXY=${NO_PROXY:-localhost,127.0.0.1}\"")
fi
if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
  python3 - "$work/buildkitd.toml" "$CODEX_PROXY_CERT" <<'PYCA'
import json, sys
with open(sys.argv[1], 'w') as output:
    for registry in ['docker.io', 'registry-1.docker.io', 'auth.docker.io']:
        output.write('[registry.' + json.dumps(registry) + ']\n  ca = [' + json.dumps(sys.argv[2]) + ']\n')
PYCA
  builder_args+=(--buildkitd-config "$work/buildkitd.toml")
fi
if docker buildx inspect "$builder" >/dev/null 2>&1; then echo 'Allocated builder name already exists' >&2; exit 1; fi
docker buildx create "${builder_args[@]}" >/dev/null
builder_created=true
# Tooling under review is separate from the pinned application source; no .env/data/credentials.
for service in batch-backend batch-frontend; do
  printf 'Building pinned %s image\n' "$service"
  dockerfile="$work/source/packages/$service/Dockerfile"
  build_args=()
  if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
    # Session CA is a BuildKit secret, never an image layer or committed Dockerfile change.
    sed -E 's|^RUN ((--mount=[^ ]+ )*)|RUN \1--mount=type=secret,id=proxy_ca,required=true export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; |' "$dockerfile" > "$work/$service.Dockerfile"
    dockerfile="$work/$service.Dockerfile"
    build_args+=(--secret "id=proxy_ca,src=$CODEX_PROXY_CERT")
  fi
  if docker image inspect "$run_id/$service:$revision" >/dev/null 2>&1; then echo 'Allocated image tag already exists' >&2; exit 1; fi
  created_images+=("$run_id/$service:$revision")
  docker buildx build --builder "$builder" --load "${build_args[@]}" --label "org.opencontainers.image.revision=$revision" -f "$dockerfile" -t "$run_id/$service:$revision" "$work/source" > "$evidence/build-$service.log" 2>&1
  docker image inspect "$run_id/$service:$revision" --format '{{json .}}' > "$evidence/image-$service.json"
done
# Exact dependency refs from production Compose; no provider requests.
for image in postgres:18.6-alpine3.24 redis:8.10.1-alpine3.23 caddy:2.11.7-alpine registry:2.8.3 motoserver/moto:5.1.15; do
  docker pull "$image" > "$evidence/pull-${image//[\/:]/-}.log" 2>&1
done
docker save "$backend" "$frontend" postgres:18.6-alpine3.24 redis:8.10.1-alpine3.23 caddy:2.11.7-alpine registry:2.8.3 motoserver/moto:5.1.15 -o "$work/images.tar"
cat > "$work/host/Dockerfile" <<'DOCKERFILE'
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd-sysv dbus ca-certificates && rm -rf /var/lib/apt/lists/*
CMD ["/sbin/init"]
DOCKERFILE
if docker image inspect "$host_image" >/dev/null 2>&1; then echo 'Allocated host image tag already exists' >&2; exit 1; fi
created_images+=("$host_image")
docker buildx build --builder "$builder" --load -t "$host_image" "$work/host" > "$evidence/build-ubuntu.log" 2>&1
docker buildx rm "$builder" >/dev/null
builder_created=false
start_host() {
  local host_name="$run_id-$phase" next_volume="$run_id-$phase-docker" next_containerd_volume="$run_id-$phase-containerd"
  if docker container inspect "$host_name" >/dev/null 2>&1 || docker volume inspect "$next_volume" >/dev/null 2>&1 || docker volume inspect "$next_containerd_volume" >/dev/null 2>&1; then
    echo 'Allocated guest resource name already exists; refusing to reuse it' >&2; exit 1
  fi
  docker volume create --label esl.rehearsal="$run_id" "$next_volume" >/dev/null
  volume="$next_volume"
  [[ "$(docker volume inspect "$volume" --format '{{index .Labels "esl.rehearsal"}}')" == "$run_id" ]]
  docker volume create --label esl.rehearsal="$run_id" "$next_containerd_volume" >/dev/null
  containerd_volume="$next_containerd_volume"
  [[ "$(docker volume inspect "$containerd_volume" --format '{{index .Labels "esl.rehearsal"}}')" == "$run_id" ]]
  extra_args=()
  if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
    extra_args+=(--mount "type=bind,src=$CODEX_PROXY_CERT,dst=/run/rehearsal-ca.crt,readonly")
  fi
  if [[ -n "${HTTP_PROXY:-}" ]]; then
    extra_args+=(--env "HTTP_PROXY=$(resolve_proxy "$HTTP_PROXY")" --env "HTTPS_PROXY=$(resolve_proxy "${HTTPS_PROXY:-$HTTP_PROXY}")" --env 'NO_PROXY=localhost,127.0.0.1,::1,rehearsal-s3,postgres,redis')
  fi
  # docker run can create a container and then fail to start it. Retain its allocated name
  # before invocation so the EXIT trap can still remove that partial allocation.
  container="$host_name"
  docker run -d --name "$host_name" --label esl.rehearsal="$run_id" --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --mount "type=volume,src=$volume,dst=/var/lib/docker" --mount "type=volume,src=$containerd_volume,dst=/var/lib/containerd" "${extra_args[@]}" "$host_image" >/dev/null
  container="$(docker inspect "$host_name" --format '{{.Id}}')" || { container="$host_name"; return 1; }
  docker inspect "$container" --format '{{json .}}' > "$evidence/$phase-host.json"
  for ((attempt=0; attempt<60; attempt++)); do
    if docker exec "$container" systemctl is-active --quiet multi-user.target; then break; fi
    sleep 1
  done
  docker exec "$container" systemctl is-active --quiet multi-user.target
  docker exec "$container" install -d -m 0750 /opt/esl-pipeline /evidence /bundle
  docker cp "$work/repository.tar" "$container:/tmp/repository.tar"
  docker cp "$work/tooling.tar" "$container:/tmp/tooling.tar"
  docker cp "$work/images.tar" "$container:/tmp/images.tar"
  docker exec "$container" bash -ec 'tar -xf /tmp/repository.tar -C /opt/esl-pipeline; tar -xf /tmp/tooling.tar -C /opt/esl-pipeline; printf "esl-disposable-recovery-v1\n" > /run/esl-recovery-disposable'
}
# Checkout files belong to the CI runner; privileged guest scripts must belong to root.
tar --owner=0 --group=0 -C "$ROOT_DIR" -cf "$work/tooling.tar" scripts/recovery
phase=source
printf 'Starting pristine source host and synthetic backup creation\n'
start_host
docker exec "$container" bash /opt/esl-pipeline/scripts/recovery/rehearse-host.sh source "$revision" "$run_id" > "$evidence/source.log" 2>&1
mkdir "$work/bundle"
docker cp "$container:/bundle/." "$work/bundle/"
docker cp "$container:/evidence/." "$evidence/"
source_container="$container"
source_volume="$volume"
source_containerd_volume="$containerd_volume"
cleanup_host
[[ -z "$container" && -z "$volume" && -z "$containerd_volume" ]] || { echo 'Source destruction failed; refusing replacement' >&2; exit 1; }
if docker container inspect "$source_container" >/dev/null 2>&1 || docker volume inspect "$source_volume" >/dev/null 2>&1 || docker volume inspect "$source_containerd_volume" >/dev/null 2>&1; then
  echo 'Source resources still exist; refusing replacement' >&2; exit 1
fi
printf '{"destroyed":true,"containerId":"%s","dockerVolume":"%s","containerdVolume":"%s"}\n' "$source_container" "$source_volume" "$source_containerd_volume" > "$evidence/source-destroyed.json"
# No old containers, volumes, uploads or deployment/monitor state crosses this boundary.
phase=replacement
printf 'Source destroyed; starting pristine replacement host recovery\n'
start_host
docker cp "$work/bundle/." "$container:/bundle/"
docker exec "$container" bash /opt/esl-pipeline/scripts/recovery/rehearse-host.sh replacement "$revision" "$run_id" > "$evidence/replacement.log" 2>&1
docker cp "$container:/evidence/." "$evidence/"
cat "$evidence/recovery-result.json"
