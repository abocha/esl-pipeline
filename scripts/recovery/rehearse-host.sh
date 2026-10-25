#!/usr/bin/env bash
# Private entrypoint: only a newly created Ubuntu guest with its own Docker daemon.
set -Eeuo pipefail
[[ "$(cat /run/esl-recovery-disposable 2>/dev/null)" == esl-disposable-recovery-v1 && $EUID == 0 ]] || { echo 'Disposable guest marker/root required' >&2; exit 1; }
[[ "$(systemd-detect-virt --container)" == docker ]] || { echo 'Disposable Docker guest required' >&2; exit 1; }
phase="${1:?source or replacement}"
revision="${2:?full application revision}"
run_id="${3:?allocated resource prefix}"
if [[ "$phase" != source && "$phase" != replacement ]] || [[ ! "$revision" =~ ^[0-9a-f]{40}$ || ! "$run_id" =~ ^esl-recovery\.[a-z0-9]+$ ]]; then
  echo 'Invalid rehearsal arguments' >&2; exit 1
fi
cd /opt/esl-pipeline
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
[[ ! -e .env && ! -e uploads && ! -e /var/lib/esl-pipeline ]]
for command in docker node aws; do
  if command -v "$command"; then echo "Host is not clean: $command" >&2; exit 1; fi
done
expect_failure() {
  local log="$1"; shift
  if "$@" > "$log" 2>&1; then echo "Expected failure: $*" >&2; exit 1; fi
}
# This is guest-only platform setup. Preserve the bootstrap's supported package path.
if [[ -f /run/rehearsal-ca.crt ]]; then
  install -m 0644 /run/rehearsal-ca.crt /usr/local/share/ca-certificates/rehearsal.crt
  update-ca-certificates
fi
install -d /etc/docker /etc/systemd/system/docker.service.d
# Let Ubuntu Docker select its supported storage driver, as on a normal clean host.
# Forcing VFS duplicates every image layer and can exhaust small disposable runners.
# Public proxy values are copied only into the isolated guest daemon, never repository evidence.
if [[ -n "${HTTPS_PROXY:-}" ]]; then
  printf '[Service]\nEnvironment="HTTP_PROXY=%s" "HTTPS_PROXY=%s" "NO_PROXY=localhost,127.0.0.1,::1"\n' "${HTTP_PROXY:-}" "$HTTPS_PROXY" > /etc/systemd/system/docker.service.d/rehearsal-proxy.conf
fi
bootstrap_rc=0
bash scripts/deploy/bootstrap-prod-host.sh apply 22 > "/evidence/$phase-bootstrap.log" 2>&1 || bootstrap_rc=$?
[[ "$bootstrap_rc" == 2 ]] # absent external inputs are an explicit bootstrap handoff
bash scripts/deploy/bootstrap-prod-host.sh verify 22 > "/evidence/$phase-bootstrap.json" || [[ $? == 2 ]]
jq -e '.bootstrapComplete and (.externalInputsPresent == false) and (.deploymentStatePresent == false)' "/evidence/$phase-bootstrap.json"
docker info --format '{{json .Driver}}' > "/evidence/$phase-storage-driver.json"
# Provision exclusively synthetic operator inputs. Never source caller .env or AWS profiles.
cat > /etc/esl-pipeline/production.env <<'ENV'
NODE_ENV=production
PG_ENABLED=true
PG_HOST=postgres
PG_PORT=5432
PG_USER=esl
PG_PASSWORD=esl
PG_DATABASE=esl_batch
PG_AUTO_MIGRATE_ON_BOOT=false
REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379
ESL_PIPELINE_CONFIG_PROVIDER=local
BATCH_BACKEND_ENABLE_EXTENDED_API=true
BATCH_BACKEND_ENABLE_OPS_CONTROL=false
JWT_SECRET=synthetic-rehearsal-jwt-signing-input-not-a-production-secret
REFRESH_COOKIE_SECURE=true
MCP_OAUTH_ENABLED=false
GOOGLE_CALENDAR_ENABLED=false
STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false
ESL_STT_PROVIDER_ELEVENLABS_API_KEY=invalid-rehearsal-no-provider
ESL_STT_PROVIDER_DEEPGRAM_API_KEY=invalid-rehearsal-no-provider
GEN_QUOTA_SOURCE_MODE=configured
GEN_OPENAI_DAILY_REQUEST_BUDGET=0
GEN_GOOGLE_DAILY_REQUEST_BUDGET=0
GEN_OPENROUTER_DAILY_REQUEST_BUDGET=0
STORAGE_PROVIDER=s3
S3_BUCKET=esl-rehearsal
S3_REGION=us-east-1
S3_ENDPOINT=http://rehearsal-s3:5000
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=synthetic-rehearsal
AWS_SECRET_ACCESS_KEY=synthetic-rehearsal
AWS_DEFAULT_REGION=us-east-1
AWS_REGION=us-east-1
AWS_EC2_METADATA_DISABLED=true
AWS_ENDPOINT_URL_S3=http://127.0.0.1:15001
PG_BACKUP_S3_BUCKET=esl-rehearsal
PG_BACKUP_S3_REGION=us-east-1
PG_BACKUP_S3_SSE=AES256
PG_BACKUP_S3_ENV=rehearsal
PG_BACKUP_ALERT_TELEGRAM_DISABLE=true
PG_BACKUP_NOTIFY_SUPPRESS=true
ENV
chmod 0600 /etc/esl-pipeline/production.env
export ESL_PRODUCTION_ENV_FILE=/etc/esl-pipeline/production.env
# The pinned Git archive is a root-owned clean snapshot, without remote credentials.
git init -q
git -c user.name=Rehearsal -c user.email=rehearsal@example.invalid add .
git -c user.name=Rehearsal -c user.email=rehearsal@example.invalid commit -qm 'Synthetic pinned source snapshot'
# Retain the normal app network and commands. Guest-only firewall blocks container Internet egress.
cat > /tmp/rehearsal-overlay.yml <<'YAML'
services:
  postgres:
    ports: !reset []
  redis:
    ports: !reset []
  caddy-edge:
    volumes:
      - /tmp/rehearsal-Caddyfile:/etc/caddy/Caddyfile:ro
    ports: !override
      - '127.0.0.1:18081:80'
      - '127.0.0.1:18443:443'
YAML
# Deploy accepts one Compose file, so resolve the production file + disposable isolation overlay.
export BATCH_BACKEND_IMAGE="localhost:15000/esl/batch-backend:$revision"
export BATCH_FRONTEND_IMAGE="localhost:15000/esl/batch-frontend:$revision"
export BATCH_BACKEND_HOST_PORT=18080 BATCH_FRONTEND_HOST_PORT=15173
export PROJECT_NAME=esl-recovery COMPOSE_PROJECT_NAME=esl-recovery
export DEPLOY_INCLUDE_EDGE=false DEPLOY_INCLUDE_OPS_BOT=false
export CADDY_PUBLIC_HOSTNAME='' CADDY_ACME_EMAIL=rehearsal@example.invalid
export COMPOSE_FILE=/var/lib/esl-pipeline/rehearsal-compose.yml
export PG_COMPOSE_FILE="$COMPOSE_FILE" PG_COMPOSE_PROJECT="$PROJECT_NAME"
export PG_BACKUP_ENV_FILE="$ESL_PRODUCTION_ENV_FILE"
export PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops
export ESL_IMAGE_PREFIX=localhost:15000/esl
export DEPLOY_STATE_DIR=/var/lib/esl-pipeline/deploy
export PG_BACKUP_DIR=/bundle/postgres
set -a
# shellcheck source=/dev/null
source "$ESL_PRODUCTION_ENV_FILE"
set +a
docker load -i /tmp/images.tar > "/evidence/$phase-loaded-images.log"
rm /tmp/images.tar
docker run -d --name rehearsal-registry -p 127.0.0.1:15000:5000 registry:2.8.3
for service in batch-backend batch-frontend; do
  docker tag "$run_id/$service:$revision" "localhost:15000/esl/$service:$revision"
  for ((attempt=0; attempt<30; attempt++)); do
    if docker push "localhost:15000/esl/$service:$revision" > "/evidence/$phase-registry-$service.log" 2>&1; then break; fi
    sleep 1
  done
  docker pull "localhost:15000/esl/$service:$revision"
  [[ "$(docker inspect "localhost:15000/esl/$service:$revision" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]]
done
# Preserve current routing while suppressing all automatic certificate acquisition, including
# the fixed marketing hostname. This guest cannot establish production DNS/TLS evidence.
sed '1a\  auto_https off' deploy/caddy/Caddyfile > /tmp/rehearsal-Caddyfile
CADDY_PUBLIC_HOSTNAME=http://recovery.invalid docker compose -f docker-compose.prod.yml -f /tmp/rehearsal-overlay.yml --profile edge config > "$COMPOSE_FILE"
chmod 0600 "$COMPOSE_FILE"
compose() { docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" "$@"; }
backend_tool() { compose run --rm --no-deps -T batch-backend node "$@"; }
# Retain edge diagnostics on either outcome; compose up returns before Caddy listens.
retain_edge_logs() {
  local exit_code=$?
  compose --profile edge logs --no-color --tail 100 caddy-edge > "/evidence/$phase-caddy.log" 2>&1 || true
  exit "$exit_code"
}
trap retain_edge_logs EXIT
# Published loopback ports require the normal bridge (Docker ignores publications on internal networks).
# Block only forwarded container egress via this guest's external NIC; host bootstrap/pulls still work.
iptables -I DOCKER-USER -o eth0 -j REJECT
iptables -C DOCKER-USER -o eth0 -j REJECT
compose up -d --wait --wait-timeout 120 postgres redis
[[ "$(docker network inspect "${PROJECT_NAME}_default" --format '{{.EnableIPv6}}')" == false ]]
# S3 is an external dependency, not an application writer. Keep the emulator outside the
# application Compose project so normal fail-closed writer discovery stays unchanged.
docker run -d --name rehearsal-s3 --network "${PROJECT_NAME}_default" --network-alias rehearsal-s3 \
  -p 127.0.0.1:15001:5000 \
  --health-cmd 'python -c "import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:5000/\", timeout=2)"' \
  --health-interval 2s --health-timeout 3s --health-retries 30 motoserver/moto:5.1.15
for ((attempt=0; attempt<60; attempt++)); do
  if [[ "$(docker inspect rehearsal-s3 --format '{{.State.Health.Status}}')" == healthy ]]; then break; fi
  sleep 1
done
[[ "$(docker inspect rehearsal-s3 --format '{{.State.Health.Status}}')" == healthy ]]
aws s3 mb s3://esl-rehearsal
if [[ "$phase" == source ]]; then
  backend_tool dist/tools/migrate-db.js migrate
  backend_tool dist/tools/migrate-db.js verify
  backend_tool dist/tools/bootstrap-prompt-assets.js
  compose up -d --wait --wait-timeout 120 batch-backend batch-frontend
  compose exec -T batch-backend node dist/tools/alpha-invites.js create --email recovery@example.test --app-url http://127.0.0.1:15173 > /tmp/invite.txt
  node scripts/recovery/product-state.mjs seed
  install -o 1000 -g 1000 -m 0600 /bundle/product.json uploads/rehearsal-product.json
  install -o 1000 -g 1000 -m 0600 packages/contracts/tests/assignment-grammar-fixture.json uploads/rehearsal-assignment.json
  # Repository domain/storage tools provide finished synthetic recording lineage; no paid STT jobs.
  compose exec -T batch-backend node --input-type=module - < scripts/recovery/seed-media.mjs > /evidence/source-media-seed.log 2>&1
  compose cp batch-backend:/app/uploads/rehearsal-media.json /bundle/media.json
  node scripts/recovery/media-fixture.mjs /bundle/media.json > /evidence/source-media.json
  rm uploads/rehearsal-product.json uploads/rehearsal-assignment.json uploads/rehearsal-media.json
  node scripts/recovery/product-state.mjs verify > /evidence/source-product.json
  # Include nonempty Redis AOF with a durable marker; no runnable provider work is introduced.
  compose exec -T redis redis-cli SET rehearsal:durable-marker "$revision"
  compose stop batch-backend batch-frontend
  bash scripts/docker/postgres-backup-restore.sh backup recovery
  compose stop redis
  redis_volume="$(docker inspect "$(compose ps -aq redis)" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
  docker run --rm --network none -v "$redis_volume:/state:ro" -v /bundle:/bundle redis:8.10.1-alpine3.23 sh -ec 'tar -cf /bundle/redis.tar -C /state .'
  tar -cf /bundle/uploads.tar -C /opt/esl-pipeline uploads
  (cd /bundle; sha256sum uploads.tar redis.tar product.json media.json > state.sha256)
  printf '%s\n' "$revision" > /bundle/application-revision
  cp /bundle/state.sha256 /evidence/source-artifacts.sha256
else
  # Nothing boots the application until backup, durable artifacts and compatibility pass.
  [[ -z "$(compose ps -q batch-backend batch-worker transcribe-worker student-memory-worker)" ]]
  node scripts/recovery/recovery-preflight.mjs /bundle "$revision" "$ESL_PRODUCTION_ENV_FILE"
  expect_failure /evidence/missing-input.log node scripts/recovery/recovery-preflight.mjs /bundle "$revision" /tmp/absent.env
  grep -q ENOENT /evidence/missing-input.log
  mv /bundle/uploads.tar /bundle/uploads.missing
  expect_failure /evidence/missing-uploads.log node scripts/recovery/recovery-preflight.mjs /bundle "$revision"
  grep -q ENOENT /evidence/missing-uploads.log
  mv /bundle/uploads.missing /bundle/uploads.tar
  cp /bundle/postgres/*.dump /tmp/corrupt.dump
  truncate -s 64 /tmp/corrupt.dump
  expect_failure /evidence/corrupt-dump.log bash scripts/docker/postgres-backup-restore.sh restore /tmp/corrupt.dump --clean
  grep -Eq 'pg_restore: error:.*(input file|end of file|archive)' /evidence/corrupt-dump.log
  # A failed restore is never accepted; --clean repairs the disposable partially restored target.
  bash scripts/docker/postgres-backup-restore.sh verify /bundle/postgres/*.dump > /evidence/backup-verify.log
  bash scripts/docker/postgres-backup-restore.sh restore /bundle/postgres/*.dump --clean > /evidence/restore.log
  tar -xf /bundle/uploads.tar -C /opt/esl-pipeline
  compose stop redis
  redis_volume="$(docker inspect "$(compose ps -aq redis)" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
  docker run --rm --network none -v "$redis_volume:/state" -v /bundle:/bundle:ro redis:8.10.1-alpine3.23 sh -ec 'rm -rf /state/*; tar -xf /bundle/redis.tar -C /state'
  compose up -d --wait --wait-timeout 120 redis
  [[ "$(compose exec -T redis redis-cli GET rehearsal:durable-marker)" == "$revision" ]]
  # Check schema against the image before the normal deploy can start application containers.
  backend_tool dist/tools/migrate-db.js verify > /evidence/migrations-verify.log
  # Deliberately incompatible migration ledger fails the normal deployment compatibility preflight.
  compose exec -T postgres psql -U esl -d esl_batch -Atqc 'SELECT id, checksum FROM schema_migrations ORDER BY id LIMIT 1' > /tmp/original-migration
  compose exec -T postgres psql -U esl -d esl_batch -v ON_ERROR_STOP=1 -c "UPDATE schema_migrations SET checksum = 'rehearsal-corrupt' WHERE id = (SELECT id FROM schema_migrations ORDER BY id LIMIT 1)"
  expect_failure /evidence/incompatible-schema.log bash scripts/deploy/deploy-prod-images.sh "$revision" --plan
  grep -q 'checksum mismatch in requested image' /evidence/incompatible-schema.log
  # Restore the injected fault; product state uses APIs/domain code, with synthetic calendar
  # authority rows standing in for external OAuth in seed-media.mjs.
  IFS='|' read -r migration_id checksum < /tmp/original-migration
  compose exec -T postgres psql -U esl -d esl_batch -v ON_ERROR_STOP=1 -v migration_id="$migration_id" -v checksum="$checksum" <<'SQL'
UPDATE schema_migrations SET checksum = :'checksum' WHERE id = :'migration_id';
SQL
  [[ -z "$(compose ps -q batch-backend batch-worker transcribe-worker student-memory-worker)" ]]
  bash scripts/deploy/deploy-prod-images.sh "$revision" > /evidence/deploy.log 2>&1
  # Use production Caddy routing locally with automatic HTTPS disabled in the guest overlay.
  # Node fetch derives Host from the URL and ignores a supplied Host header. Resolve only
  # this synthetic hostname inside the disposable guest; never use external DNS.
  printf '127.0.0.1 recovery.invalid\n' >> /etc/hosts
  compose --profile edge run --rm --no-deps caddy-edge caddy validate --config /etc/caddy/Caddyfile > /evidence/caddy-validate.log 2>&1
  CADDY_PUBLIC_HOSTNAME=http://recovery.invalid compose --profile edge up -d --no-build --no-deps caddy-edge
  curl --retry 30 --retry-all-errors --retry-delay 1 --retry-max-time 60 --connect-timeout 2 --max-time 5 -fsS -H 'Host: recovery.invalid' http://127.0.0.1:18081/ > /evidence/frontend.html
  curl -fsS -H 'Host: recovery.invalid' http://127.0.0.1:18081/api/health > /evidence/edge-health.json
  node scripts/recovery/product-state.mjs verify-edge > /evidence/recovered-product.json
  mapfile -t workers < <(compose ps -q batch-worker transcribe-worker student-memory-worker)
  # The current-instance verifier rejects a replacement process without any readiness record.
  probe="$(docker run -d --network none --label com.docker.compose.service=batch-worker --entrypoint sleep "$BATCH_BACKEND_IMAGE" 120)"
  expect_failure /evidence/absent-worker-readiness.log node --input-type=module -e 'import { verifyWorkersReady } from "./scripts/deploy/verify-workers-ready.mjs"; await verifyWorkersReady(process.argv.slice(1), { timeoutMs: 1000 });' "$probe" "$(compose ps -q transcribe-worker)" "$(compose ps -q student-memory-worker)"
  grep -q 'Current-instance worker_ready evidence missing' /evidence/absent-worker-readiness.log
  docker rm -f "$probe"
  mapfile -t workers < <(compose ps -q batch-worker transcribe-worker student-memory-worker)
  node scripts/deploy/verify-workers-ready.mjs "${workers[@]}" > /evidence/workers-ready.json
  node scripts/recovery/verify-recovery.mjs "$revision"
fi
