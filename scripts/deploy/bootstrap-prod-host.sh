#!/usr/bin/env bash
# Host preparation only. Never sources .env, deploys images, or runs operations jobs.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
MODE="${1:-}"
# Always target the host-local daemon, never a caller-selected remote context.
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
SSH_PORT="${2:-}"
die() { echo "ERROR: $*" >&2; exit 1; }
[[ "$MODE" == apply || "$MODE" == verify ]] || die "usage: sudo bash scripts/deploy/bootstrap-prod-host.sh apply|verify <SSH-port>"
if [[ ! "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || ((10#$SSH_PORT < 1 || 10#$SSH_PORT > 65535)); then
  die "supply the actual operator-approved SSH TCP port (1..65535)"
fi
[[ $EUID == 0 ]] || die "run as root with sudo; deploy and systemd jobs use root, not a new Docker-group user"
[[ "$ROOT_DIR" == /opt/esl-pipeline ]] || die "place the reviewed repository checkout at /opt/esl-pipeline first"
# shellcheck source=/dev/null
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die "supported host: Ubuntu 24.04 LTS; found $ID $VERSION_ID"
case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64; AWS_ARCH=x86_64 ;;
  arm64) NODE_ARCH=arm64; AWS_ARCH=aarch64 ;;
  *) die "supported architectures: amd64, arm64" ;;
esac
[[ -d /run/systemd/system ]] || die "a running systemd host is required (not an ordinary Docker container)"
# Never follow operator-owned links or recursively change unknown contents.
paths=(
  /etc/esl-pipeline /opt/esl-pipeline /opt/esl-pipeline/.secrets /opt/esl-pipeline/uploads
  /opt/esl-pipeline/uploads/drafts /var/lib/esl-pipeline /var/lib/esl-pipeline/deploy
  /var/lib/esl-pipeline/deploy/backups /var/lib/esl-pipeline/deploy/backups/postgres
  /var/lib/esl-pipeline/ops /var/lib/esl-pipeline/ops/backups
  /var/lib/esl-pipeline/ops/backups/postgres /var/lib/esl-pipeline/ops/backups/postgres/remote-restore
  /var/lib/esl-pipeline/ops/logs /var/lib/esl-pipeline/ops/reports
  /var/lib/esl-pipeline/ops/run /var/lib/esl-pipeline/ops/state
)
for path in "${paths[@]}" /etc/docker /etc/docker/daemon.json /etc/systemd/journald.conf.d /etc/systemd/journald.conf.d/esl-pipeline.conf; do
  [[ ! -L "$path" ]] || die "refusing symlink: $path"
done
if [[ "$MODE" == verify ]]; then
  command -v node >/dev/null || die "Node is missing; run apply first"
  exec node "$ROOT_DIR/scripts/deploy/verify-prod-host.mjs" "$SSH_PORT"
fi
# Existing mismatched ownership is an operator decision, not an invitation to chown recursively.
for path in "${paths[@]}"; do
  owner=0:0
  [[ "$path" == */.secrets ]] && owner=0:1000
  [[ "$path" == */uploads || "$path" == */uploads/drafts ]] && owner=1000:1000
  if [[ -e "$path" ]]; then
    [[ -d "$path" && "$(stat -c %u:%g "$path")" == "$owner" ]] || die "expected directory $path owned by $owner; inspect/repair existing host state explicitly"
  fi
done
for unit in "$ROOT_DIR"/deploy/systemd/*; do
  [[ ! -L "/etc/systemd/system/$(basename "$unit")" ]] || die "refusing linked unit: $unit"
done
# Do not replace another Docker distribution or remove packages to make apt converge.
if command -v docker >/dev/null && ! dpkg-query -W -f='${Status}' docker.io 2>/dev/null | grep -qx 'install ok installed'; then
  die "existing Docker is not Ubuntu docker.io; reconcile explicitly before using this v1 path"
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -o Dpkg::Options::=--force-confold install -y --no-install-recommends ca-certificates curl git jq xz-utils unzip gnupg ufw openssh-server logrotate
install -d -m 0755 /etc/docker /etc/systemd/journald.conf.d
# Respect all unrelated daemon settings. Refuse conflicting logging rather than restart workloads.
if [[ -e /etc/docker/daemon.json ]]; then
  jq -e 'type == "object" and (."log-driver" == null or ."log-driver" == "json-file") and
    (."log-opts" == null or (."log-opts" | type == "object")) and
    (."log-opts"."max-size" == null or ."log-opts"."max-size" == "10m") and
    (."log-opts"."max-file" == null or ."log-opts"."max-file" == "5")' /etc/docker/daemon.json >/dev/null \
    || die "malformed/conflicting Docker logging config; reconcile explicitly (json-file, 10m, 5 files)"
fi
config_tmp="$(mktemp)"
trap 'rm -f "$config_tmp"' EXIT
jq '. + {"log-driver":"json-file", "log-opts":((."log-opts" // {}) + {"max-size":"10m","max-file":"5"})}' \
  <(cat /etc/docker/daemon.json 2>/dev/null || echo '{}') >"$config_tmp"
if ! cmp -s "$config_tmp" /etc/docker/daemon.json; then
  if systemctl is-active --quiet docker.service; then
    die "active Docker daemon needs logging configuration change; reconcile and restart it explicitly before rerun"
  fi
  install -m 0644 "$config_tmp" /etc/docker/daemon.json
fi
# Ubuntu's maintained Engine + Compose v2 packages; no convenience installer or app images.
apt-get -o Dpkg::Options::=--force-confold install -y --no-install-recommends docker.io docker-compose-v2
if command -v aws >/dev/null; then
  [[ "$(aws --version 2>&1)" == aws-cli/2.* ]] || die "existing AWS CLI is unsupported; reconcile to AWS CLI v2 explicitly"
else
  [[ ! -e /usr/local/aws-cli && ! -e /usr/local/bin/aws && ! -L /usr/local/bin/aws ]] || die "refusing existing/partial AWS CLI installation"
  aws_tmp="$(mktemp -d)"
  trap 'rm -f "$config_tmp"; rm -rf "$aws_tmp"' EXIT
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o "$aws_tmp/awscliv2.zip"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip.sig" -o "$aws_tmp/awscliv2.zip.sig"
  install -d -m 0700 "$aws_tmp/gnupg"
  gpg --homedir "$aws_tmp/gnupg" --batch --import "$ROOT_DIR/deploy/host/aws-cli-signing-key.asc"
  gpg --homedir "$aws_tmp/gnupg" --batch --verify "$aws_tmp/awscliv2.zip.sig" "$aws_tmp/awscliv2.zip" || die "AWS CLI signature verification failed"
  unzip -q "$aws_tmp/awscliv2.zip" -d "$aws_tmp"
  "$aws_tmp/aws/install"
  rm -rf "$aws_tmp"
  trap 'rm -f "$config_tmp"' EXIT
fi
node_version="$(cat "$ROOT_DIR/.nvmrc")"
[[ "$node_version" =~ ^24\.[0-9]+\.[0-9]+$ ]] || die "expected exact Node 24 version in .nvmrc"
if command -v node >/dev/null; then
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major===24 && minor>=15 ? 0 : 1)' \
    || die "existing Node is unsupported; install Node 24.15+ explicitly or remove the conflicting installation"
else
  node_dir="/opt/esl-pipeline-host/node-v${node_version}-linux-${NODE_ARCH}"
  [[ ! -e /opt/esl-pipeline-host ]] || die "Node is absent but /opt/esl-pipeline-host exists; inspect interrupted/unknown installation"
  node_tmp="$(mktemp -d)"
  trap 'rm -f "$config_tmp"; rm -rf "$node_tmp"' EXIT
  archive="node-v${node_version}-linux-${NODE_ARCH}.tar.xz"
  curl --fail --show-error --silent --location "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$node_tmp/SHASUMS256.txt"
  curl --fail --show-error --silent --location "https://nodejs.org/dist/v${node_version}/${archive}" -o "$node_tmp/$archive"
  (cd "$node_tmp"; grep " ${archive}$" SHASUMS256.txt | sha256sum --check --status) || die "Node archive checksum failed"
  install -d -m 0755 /opt/esl-pipeline-host
  tar -xJf "$node_tmp/$archive" -C /opt/esl-pipeline-host --no-same-owner
  [[ ! -e /usr/local/bin/node && ! -L /usr/local/bin/node ]] || die "refusing to replace /usr/local/bin/node"
  ln -s "$node_dir/bin/node" /usr/local/bin/node
fi
for path in "${paths[@]}"; do
  owner=0; group=0
  [[ "$path" == */.secrets ]] && group=1000
  [[ "$path" == */uploads || "$path" == */uploads/drafts ]] && owner=1000 && group=1000
  # Change only directory metadata, never existing child files or secret values.
  install -d -o "$owner" -g "$group" -m 0750 "$path"
done
cat >"$config_tmp" <<'JOURNAL'
# Managed by scripts/deploy/bootstrap-prod-host.sh
[Journal]
Storage=persistent
SystemMaxUse=256M
MaxRetentionSec=1month
JOURNAL
journal_changed=false
if ! cmp -s "$config_tmp" /etc/systemd/journald.conf.d/esl-pipeline.conf; then
  install -m 0644 "$config_tmp" /etc/systemd/journald.conf.d/esl-pipeline.conf
  journal_changed=true
fi
if [[ "$journal_changed" == true ]]; then
  systemctl restart systemd-journald.service
  journalctl --flush
fi
systemctl enable --now docker.service
# No Docker restart: an existing daemon with stale settings is a verification failure.
bash "$ROOT_DIR/scripts/deploy/install-postgres-ops-systemd.sh"
for timer in "$ROOT_DIR"/deploy/systemd/*.timer; do
  systemctl enable "$(basename "$timer")"
done
# Timers are enabled for boot, deliberately not started; activation belongs to deployment.
node "$ROOT_DIR/scripts/deploy/verify-prod-host.mjs" "$SSH_PORT"
