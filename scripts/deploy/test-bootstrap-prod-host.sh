#!/usr/bin/env bash
# Destructive only inside a new, disposable privileged Ubuntu container. No host socket mount.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
command -v docker >/dev/null
docker --host=unix:///var/run/docker.sock info >/dev/null
work_dir="$(mktemp -d)"
container="esl-bootstrap-rehearsal-$$"
image="esl-bootstrap-rehearsal:$$"
cleanup() {
  if [[ -n "${ESL_BOOTSTRAP_EVIDENCE_DIR:-}" ]]; then
    mkdir -p "$ESL_BOOTSTRAP_EVIDENCE_DIR"
    for file in first.log first.json second.log second.json before-second after-second symlink.log malformed.log malformed.json unsupported.log deploy-missing-env.log monitor-missing-env.log compose.json migration.log migration.json ufw.log ufw-status.log firewall.json firewall-unsafe.json completed; do
      docker cp "$container:/tmp/$file" "$ESL_BOOTSTRAP_EVIDENCE_DIR/$file" 2>/dev/null || true
    done
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT
cat >"$work_dir/Dockerfile" <<'DOCKERFILE'
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd-sysv dbus ca-certificates && rm -rf /var/lib/apt/lists/*
CMD ["/sbin/init"]
DOCKERFILE
docker build -t "$image" "$work_dir"
extra_args=()
# Cloud's public CA bundle is runtime-only; never put session-specific trust in repository assets.
if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
  extra_args+=(--mount "type=bind,src=/etc/ssl/certs/ca-certificates.crt,dst=/run/rehearsal-ca.pem,readonly" -e CURL_CA_BUNDLE=/run/rehearsal-ca.pem)
fi
docker run -d --name "$container" --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock --tmpfs /var/lib/docker --tmpfs /var/lib/containerd "${extra_args[@]}" "$image"
# Wait for boot tmpfiles cleanup before copying evidence/source into /tmp.
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$container" systemctl is-active --quiet multi-user.target; then break; fi
  sleep 1
done
docker exec "$container" systemctl is-active --quiet multi-user.target
# Include tracked and new nonignored source, never host credentials, node_modules or runtime data.
# Windows/WSL checkouts may expose files as uid 1000/mode 0777. The disposable fixture models
# root-owned reviewed source; normalize archive metadata only, never the developer checkout.
(cd "$ROOT_DIR"; git ls-files --cached --others --exclude-standard -z | tar --owner=0 --group=0 --mode=go-w --null -T - -cf "$work_dir/repository.tar")
docker cp "$work_dir/repository.tar" "$container:/tmp/repository.tar"
docker exec -i "$container" bash -s <<'REHEARSAL'
set -euo pipefail
for ((attempt = 0; attempt < 30; attempt++)); do
  [[ -d /run/systemd/system ]] && break
  sleep 1
done
[[ -d /run/systemd/system ]]
install -d -m 0750 /opt/esl-pipeline
tar -xf /tmp/repository.tar -C /opt/esl-pipeline
cd /opt/esl-pipeline
[[ ! -e .env && ! -e uploads && ! -e /var/lib/esl-pipeline ]]
! command -v docker
! command -v node
! command -v aws
expect_exit() {
  local expected="$1"; shift
  local actual=0
  "$@" || actual=$?
  [[ "$actual" == "$expected" ]] || { echo "Expected exit $expected, found $actual: $*" >&2; exit 1; }
}
expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh apply 22 > /tmp/first.log 2>&1
expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh verify 22 > /tmp/first.json
jq -e '.bootstrapComplete and (.externalInputsPresent == false) and (.deploymentStatePresent == false) and (.productionReadiness == "not-assessed") and ([.checks[] | select(.category == "bootstrap" and .passed == false)] | length == 0)' /tmp/first.json
[[ ! -e .env && ! -e .secrets/google-service-account.json ]]
[[ "$(docker ps -aq | wc -l)" == 0 ]]
[[ "$(docker volume ls -q | wc -l)" == 0 ]]
# Real manager: units load, timers enabled but inactive, no oneshot executed.
systemd-analyze verify /etc/systemd/system/esl-*.service /etc/systemd/system/esl-*.timer
for timer in deploy/systemd/*.timer; do
  systemctl is-enabled "$(basename "$timer")"
  ! systemctl is-active --quiet "$(basename "$timer")"
  [[ "$(systemctl show "${timer##*/}" -p LastTriggerUSec --value)" == '' ]]
done
for service in deploy/systemd/*.service; do
  [[ "$(systemctl show "${service##*/}" -p ExecMainStartTimestamp --value)" == '' ]]
done
# Verify effective defaults using a local empty image/container: no pull, process or app deployment.
tar -cf /tmp/empty-image.tar --files-from /dev/null
docker import /tmp/empty-image.tar bootstrap-empty:rehearsal >/dev/null
probe="$(docker create bootstrap-empty:rehearsal /never-run)"
docker inspect "$probe" --format '{{json .HostConfig.LogConfig}}' | jq -e '.Type == "json-file" and .Config["max-size"] == "10m" and .Config["max-file"] == "5"'
docker rm "$probe" >/dev/null
docker image rm bootstrap-empty:rehearsal >/dev/null
# Runtime UID can write uploads and read a synthetic noncredential marker through the secret mount.
printf 'disposable-permission-probe\n' > .secrets/rehearsal-marker
chown 0:1000 .secrets/rehearsal-marker
chmod 0640 .secrets/rehearsal-marker
# Bind through a traversable parent, as Docker does; checkout permissions are host-only.
install -d -m 0755 /run/runtime /run/runtime/uploads /run/runtime/secrets
mount --bind "$PWD/uploads" /run/runtime/uploads
mount --bind "$PWD/.secrets" /run/runtime/secrets
setpriv --reuid=1000 --regid=1000 --clear-groups bash -c 'test -r /run/runtime/secrets/rehearsal-marker; touch /run/runtime/uploads/drafts/rehearsal-marker'
umount /run/runtime/uploads /run/runtime/secrets
rm .secrets/rehearsal-marker uploads/drafts/rehearsal-marker
snapshot() {
  find /var/lib/esl-pipeline uploads .secrets -type d -printf '%p %U:%G %m\n' | sort
  sha256sum /etc/docker/daemon.json /etc/systemd/journald.conf.d/esl-pipeline.conf /etc/systemd/system/esl-*.*
  stat -c '%n %Y' /etc/docker/daemon.json /etc/systemd/journald.conf.d/esl-pipeline.conf /etc/systemd/system/esl-*.*
  node --version
  aws --version
  docker info --format '{{.ID}}'
  systemctl show docker.service -p ExecMainStartTimestamp --value
}
snapshot > /tmp/before-second
expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh apply 22 > /tmp/second.log 2>&1
snapshot > /tmp/after-second
diff -u /tmp/before-second /tmp/after-second
expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh verify 22 > /tmp/second.json
cmp /tmp/first.json /tmp/second.json
# Unknown layout and malformed daemon config fail without replacing the unknown object.
rmdir /var/lib/esl-pipeline/ops/run
ln -s /tmp /var/lib/esl-pipeline/ops/run
expect_exit 1 bash scripts/deploy/bootstrap-prod-host.sh apply 22 > /tmp/symlink.log 2>&1
grep -q 'refusing symlink' /tmp/symlink.log
[[ -L /var/lib/esl-pipeline/ops/run ]]
rm /var/lib/esl-pipeline/ops/run
install -d -m 0750 /var/lib/esl-pipeline/ops/run
cp /etc/docker/daemon.json /tmp/daemon-original
printf '{malformed\n' > /etc/docker/daemon.json
expect_exit 1 bash scripts/deploy/bootstrap-prod-host.sh verify 22 > /tmp/malformed.json
jq -e '.bootstrapComplete == false and any(.checks[]; .id == "docker-log-config" and .passed == false)' /tmp/malformed.json
expect_exit 1 bash scripts/deploy/bootstrap-prod-host.sh apply 22 > /tmp/malformed.log 2>&1
grep -q 'malformed/conflicting Docker logging config' /tmp/malformed.log
grep -qx '{malformed' /etc/docker/daemon.json
cp /tmp/daemon-original /etc/docker/daemon.json
cp /etc/os-release /tmp/os-release-original
sed -i 's/24.04/22.04/g' /etc/os-release
expect_exit 1 bash scripts/deploy/bootstrap-prod-host.sh apply 22 > /tmp/unsupported.log 2>&1
grep -q 'supported host: Ubuntu 24.04' /tmp/unsupported.log
cp /tmp/os-release-original /etc/os-release
# Absent inputs fail normal deploy/monitor entrypoints before images/network/state mutation.
expect_exit 1 bash scripts/deploy/deploy-prod-images.sh 0000000000000000000000000000000000000000 > /tmp/deploy-missing-env.log 2>&1
grep -q 'missing required env file' /tmp/deploy-missing-env.log
expect_exit 1 bash scripts/docker/run-host-runtime-health-alert.sh > /tmp/monitor-missing-env.log 2>&1
grep -q 'Missing trusted path' /tmp/monitor-missing-env.log
[[ ! -e /var/lib/esl-pipeline/deploy/current-images.env ]]
# Compose render only, with explicit disposable image refs and a comment-only fixture environment.
printf '# Disposable Compose configuration fixture; no secrets or deployment\n' > /etc/esl-pipeline/production.env
chmod 0600 /etc/esl-pipeline/production.env
BATCH_BACKEND_IMAGE=fixture/backend:rehearsal BATCH_FRONTEND_IMAGE=fixture/frontend:rehearsal docker compose -f docker-compose.prod.yml config --format json > /tmp/compose.json
# Compose serializes default false as an absent JSON key; explicit true must still fail.
jq -e '.services["batch-backend"].volumes | any(.source == "/opt/esl-pipeline/uploads" and .bind.create_host_path != true)' /tmp/compose.json
jq -e '.services["batch-backend"].volumes | any(.source == "/opt/esl-pipeline/.secrets" and .read_only == true and .bind.create_host_path != true)' /tmp/compose.json
rm /etc/esl-pipeline/production.env
# Real config reconciliation with synthetic credentials, an ordinary protected Git checkout,
# and a container on this disposable host's own daemon. No application/provider is invoked.
(
  set -euo pipefail
  git init -q
  git add .
  git -c user.name=Rehearsal -c user.email=rehearsal@example.invalid commit -qm 'Synthetic reviewed host fixture'
  printf 'REHEARSAL_PROVIDER_API_KEY=synthetic-provider-key\nREHEARSAL_PUBLISHED_PORT=19876\n' > .env
  chmod 0600 .env
  printf '{"rehearsal":true}\n' > .secrets/google-service-account.json
  cp .env .secrets/.env.backup-rehearsal
  chown 1000:1000 .secrets .secrets/* .secrets/.env.backup-rehearsal
  chmod 0700 .secrets
  chmod 0600 .secrets/* .secrets/.env.backup-rehearsal
  chown 1000:1000 /opt/esl-pipeline
  chmod 0755 /opt/esl-pipeline
  expect_exit 1 node scripts/deploy/production-paths.mjs deploy "$PWD" /var/lib/esl-pipeline/deploy

  install -d -o root -g root -m 0700 /var/lib/esl-pipeline-config-backups/rehearsal
  install -o root -g root -m 0600 .env /var/lib/esl-pipeline-config-backups/rehearsal/previous.env
  install -o root -g root -m 0600 .secrets/google-service-account.json /var/lib/esl-pipeline-config-backups/rehearsal/previous-google.json
  install -o root -g root -m 0600 .env /etc/esl-pipeline/production.env
  cmp -s .env /etc/esl-pipeline/production.env
  chown 0:0 /opt/esl-pipeline
  chmod 0750 /opt/esl-pipeline
  chown 0:1000 .secrets .secrets/google-service-account.json
  chmod 0750 .secrets
  chmod 0640 .secrets/google-service-account.json
  # The mounted operator backup is rejected even after directory/key metadata is reconciled.
  expect_exit 1 node scripts/deploy/production-paths.mjs deploy "$PWD" /var/lib/esl-pipeline/deploy
  cmp -s .secrets/.env.backup-rehearsal /var/lib/esl-pipeline-config-backups/rehearsal/previous.env
  mv .secrets/.env.backup-rehearsal /var/lib/esl-pipeline-config-backups/rehearsal/old-mounted-backup.env
  chown 0:0 /var/lib/esl-pipeline-config-backups/rehearsal/old-mounted-backup.env
  chmod 0600 /var/lib/esl-pipeline-config-backups/rehearsal/old-mounted-backup.env
  node scripts/deploy/production-paths.mjs deploy "$PWD" /var/lib/esl-pipeline/deploy
  expect_exit 1 node scripts/deploy/production-paths.mjs deploy "$PWD" /var/lib/esl-pipeline/deploy "$PWD/.env"
  node --test scripts/deploy/production-paths.test.mjs

  mkdir /tmp/config-probe
  cat > /tmp/config-probe/Dockerfile <<'PROBE_IMAGE'
FROM scratch
COPY /bin/busybox /bin/busybox
ENTRYPOINT ["/bin/busybox", "sh"]
PROBE_IMAGE
  # Ubuntu's static BusyBox is a synthetic local runtime, not a production application image.
  apt-get install -y --no-install-recommends busybox-static
  install -D /bin/busybox /tmp/config-probe/bin/busybox
  docker build -t bootstrap-config-probe:rehearsal /tmp/config-probe
  cat > /tmp/config-probe.yml <<'PROBE_COMPOSE'
services:
  credential-probe:
    image: ${REHEARSAL_IMAGE:?Supply synthetic image state}
    user: '1000:1000'
    network_mode: none
    env_file:
      - /etc/esl-pipeline/production.env
    environment:
      GOOGLE_APPLICATION_CREDENTIALS: /app/secrets/google-service-account.json
      INTERPOLATED_PORT: ${REHEARSAL_PUBLISHED_PORT:?Supply canonical config}
    volumes:
      - /opt/esl-pipeline/.secrets:/app/secrets:ro
      - /opt/esl-pipeline/uploads:/app/uploads
PROBE_COMPOSE
  printf 'REHEARSAL_IMAGE=bootstrap-config-probe:rehearsal\n' > /tmp/config-images.env
  chmod 0600 /tmp/config-images.env
  run_probe() {
    docker compose -p esl-config-rehearsal -f /tmp/config-probe.yml \
      --env-file /etc/esl-pipeline/production.env --env-file /tmp/config-images.env \
      run --interactive=false --rm --no-deps credential-probe -ec '
        test "$REHEARSAL_PROVIDER_API_KEY" = synthetic-provider-key
        test "$INTERPOLATED_PORT" = 19876
        test -r "$GOOGLE_APPLICATION_CREDENTIALS"
        test ! -w "$GOOGLE_APPLICATION_CREDENTIALS"
        test ! -e /app/secrets/.env.backup-rehearsal
        touch /app/uploads/drafts/rehearsal-marker
        test "$(id -u)" = 1000
      '
  }
  run_probe
  # Removing the old path does not affect the canonical consumer or container startup.
  rm .env
  node scripts/deploy/production-paths.mjs deploy "$PWD" /var/lib/esl-pipeline/deploy
  run_probe
  # Operator rollback restores exact previous env bytes without remounting operator backups.
  install -o root -g root -m 0600 /var/lib/esl-pipeline-config-backups/rehearsal/previous.env .env
  cmp -s .env /var/lib/esl-pipeline-config-backups/rehearsal/previous.env
  cmp -s .secrets/google-service-account.json /var/lib/esl-pipeline-config-backups/rehearsal/previous-google.json
  test ! -e .secrets/.env.backup-rehearsal
  docker image rm bootstrap-config-probe:rehearsal
  rm uploads/drafts/rehearsal-marker
  node scripts/deploy/verify-prod-host.mjs 22 > /tmp/migration.json || test "$?" = 2
  jq -e 'any(.checks[]; .id == "trusted-config-paths" and .passed == true) and any(.checks[]; .id == "external-env" and .passed == true)' /tmp/migration.json
  printf 'PASS: config migration, real UID-1000 container credentials/env loading, removal of old path, and config rollback.\n'
) > /tmp/migration.log 2>&1
cat /tmp/migration.log
rm .env /etc/esl-pipeline/production.env .secrets/google-service-account.json
# UFW lives solely in this container network namespace; kernel limitations are retained as evidence.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
if ufw --force enable > /tmp/ufw.log 2>&1; then
  ufw status verbose > /tmp/ufw-status.log 2>&1
  cat /tmp/ufw-status.log
  expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh verify 22 > /tmp/firewall.json
  jq -e 'any(.checks[]; .id == "host-firewall" and .passed == true)' /tmp/firewall.json
  ufw allow 8080/tcp
  expect_exit 2 bash scripts/deploy/bootstrap-prod-host.sh verify 22 > /tmp/firewall-unsafe.json
  jq -e 'any(.checks[]; .id == "host-firewall" and .passed == false)' /tmp/firewall-unsafe.json
else
  printf 'ENVIRONMENT LIMITATION: UFW kernel execution failed; retain /tmp/ufw.log and validate rule parser separately.\n'
  cat /tmp/ufw.log
fi
printf 'PASS: fresh bootstrap, rerun convergence, real systemd integration, paths/runtime permissions, logging defaults, failure boundaries, and Compose/deploy contracts.\n'
touch /tmp/completed
REHEARSAL
# docker exec is fed a streamed script: nested CLI probes must never consume that input.
# Require an explicit marker instead of treating premature script EOF as successful completion.
docker exec "$container" test -f /tmp/completed
