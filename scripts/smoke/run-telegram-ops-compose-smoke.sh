#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
PROFILE="telegram-smoke"
PROJECT_NAME="${TELEGRAM_SMOKE_COMPOSE_PROJECT:-esl-telegram-smoke-${RANDOM}}"
ARTIFACT_DIR="${TELEGRAM_SMOKE_ARTIFACT_DIR:-${ROOT_DIR}/.artifacts/telegram-compose-smoke}"

API_PORT="${TELEGRAM_SMOKE_API_HOST_PORT:-18080}"
BACKEND_PORT="${TELEGRAM_SMOKE_BACKEND_HOST_PORT:-18081}"

API_URL="http://127.0.0.1:${API_PORT}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

SMOKE_CHAT_ID="${TELEGRAM_SMOKE_CHAT_ID:--1001234567890}"
SMOKE_ALLOWED_USER_ID="${TELEGRAM_SMOKE_ALLOWED_USER_ID:-12345678}"
SMOKE_SHARE_JOB_ID="${TELEGRAM_SMOKE_SHARE_JOB_ID:-job-smoke-1}"
SMOKE_OP_ID="${TELEGRAM_SMOKE_OP_ID:-smoke-op-1}"

mkdir -p "${ARTIFACT_DIR}"

compose() {
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" --profile "${PROFILE}" "$@"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local timeout_seconds="${3:-90}"

  local attempt=1
  while (( attempt <= timeout_seconds )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  echo "ERROR: timed out waiting for ${label} at ${url}" >&2
  return 1
}

wait_for_topics_ready() {
  local timeout_seconds="${1:-120}"
  local attempt=1

  while (( attempt <= timeout_seconds )); do
    if curl -fsS "${API_URL}/_test/state" | node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); const names=new Set((s.createdTopics||[]).map((t)=>t.name)); process.exit(names.has('Ops Control')&&names.has('Jobs')&&names.has('Alerts')?0:1);" ; then
      return 0
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "ERROR: topic creation did not complete in time" >&2
  return 1
}

wait_for_messages() {
  local expected_count="$1"
  local timeout_seconds="${2:-120}"
  local attempt=1

  while (( attempt <= timeout_seconds )); do
    if curl -fsS "${API_URL}/_test/state" | EXPECTED_COUNT="${expected_count}" node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); const n=(s.sentMessages||[]).length; process.exit(n>=Number(process.env.EXPECTED_COUNT)?0:1);" ; then
      return 0
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "ERROR: expected at least ${expected_count} outbound messages, timeout reached" >&2
  return 1
}

cleanup() {
  local exit_code="$?"
  set +e

  compose ps >"${ARTIFACT_DIR}/compose-ps.txt" 2>&1
  compose logs --no-color >"${ARTIFACT_DIR}/compose-logs.txt" 2>&1
  curl -fsS "${API_URL}/_test/state" >"${ARTIFACT_DIR}/telegram-api-state.json" 2>/dev/null
  curl -fsS "${BACKEND_URL}/_test/state" >"${ARTIFACT_DIR}/fake-backend-state.json" 2>/dev/null

  compose down --volumes --remove-orphans >"${ARTIFACT_DIR}/compose-down.txt" 2>&1

  if [[ "${exit_code}" -eq 0 ]]; then
    echo "Telegram compose smoke completed successfully. Artifacts: ${ARTIFACT_DIR}"
  else
    echo "Telegram compose smoke failed. Artifacts: ${ARTIFACT_DIR}" >&2
  fi

  exit "${exit_code}"
}
trap cleanup EXIT

export TELEGRAM_SMOKE_BACKEND_SECRET="${TELEGRAM_SMOKE_BACKEND_SECRET:-smoke-secret}"
export TELEGRAM_SMOKE_BACKEND_EMAIL="${TELEGRAM_SMOKE_BACKEND_EMAIL:-ops-bot@example.com}"
export TELEGRAM_SMOKE_BACKEND_PASSWORD="${TELEGRAM_SMOKE_BACKEND_PASSWORD:-smoke-password}"
export TELEGRAM_SMOKE_BOT_TOKEN="${TELEGRAM_SMOKE_BOT_TOKEN:-123456789:smoke-token}"

compose up -d telegram-smoke-api telegram-smoke-backend

wait_for_http "${API_URL}/_health" "fake Telegram API"
wait_for_http "${BACKEND_URL}/_health" "fake backend"

curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/reset" -d '{}' >/dev/null

now_epoch="$(date +%s)"

cat <<JSON | curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/enqueue-updates" -d @- >/dev/null
{
  "updates": [
    {
      "update_id": 300,
      "message": {
        "message_id": 300,
        "date": ${now_epoch},
        "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "text": "/status"
      }
    }
  ]
}
JSON

compose up -d telegram-ops-bot-smoke

wait_for_topics_ready

cat <<JSON | curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/enqueue-updates" -d @- >/dev/null
{
  "updates": [
    {
      "update_id": 301,
      "message": {
        "message_id": 301,
        "date": ${now_epoch},
        "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "text": "/status"
      }
    },
    {
      "update_id": 302,
      "message": {
        "message_id": 302,
        "date": ${now_epoch},
        "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "text": "/op ${SMOKE_OP_ID}"
      }
    },
    {
      "update_id": 303,
      "message": {
        "message_id": 303,
        "date": ${now_epoch},
        "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "text": "/share ${SMOKE_SHARE_JOB_ID}"
      }
    }
  ]
}
JSON

wait_for_messages 5

curl -fsS "${API_URL}/_test/state" >"${ARTIFACT_DIR}/telegram-api-state.final.json"
curl -fsS "${BACKEND_URL}/_test/state" >"${ARTIFACT_DIR}/fake-backend-state.final.json"

STATE_PATH="${ARTIFACT_DIR}/telegram-api-state.final.json" \
BACKEND_STATE_PATH="${ARTIFACT_DIR}/fake-backend-state.final.json" \
EXPECTED_CHAT_ID="${SMOKE_CHAT_ID}" \
EXPECTED_OP_ID="${SMOKE_OP_ID}" \
node <<'NODE'
const fs = require('node:fs');

const state = JSON.parse(fs.readFileSync(process.env.STATE_PATH, 'utf8'));
const backendState = JSON.parse(fs.readFileSync(process.env.BACKEND_STATE_PATH, 'utf8'));

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const createdTopics = state.createdTopics ?? [];
const sentMessages = state.sentMessages ?? [];
const metadata = state.metadata ?? {};
const topicByName = new Map(createdTopics.map((topic) => [topic.name, topic.message_thread_id]));

const opsThread = topicByName.get('Ops Control');
const jobsThread = topicByName.get('Jobs');

assert(typeof opsThread === 'number', 'Missing created Ops Control topic thread id');
assert(typeof jobsThread === 'number', 'Missing created Jobs topic thread id');

const commandScopes = metadata.commands ?? [];
assert(commandScopes.length === 2, `Expected exactly 2 setMyCommands calls, got ${commandScopes.length}`);

const privateScope = commandScopes.find((entry) => entry?.payload?.scope?.type === 'all_private_chats');
assert(Boolean(privateScope), 'Missing all_private_chats command scope registration');
if (privateScope) {
  const privateCommands = (privateScope.payload.commands ?? []).map((command) => command.command);
  assert(
    JSON.stringify(privateCommands) === JSON.stringify(['start', 'help']),
    `Unexpected private command scope: ${JSON.stringify(privateCommands)}`,
  );
}

const opsScope = commandScopes.find(
  (entry) =>
    entry?.payload?.scope?.type === 'chat' &&
    String(entry?.payload?.scope?.chat_id) === String(process.env.EXPECTED_CHAT_ID),
);
assert(Boolean(opsScope), 'Missing configured ops chat command scope registration');
if (opsScope) {
  const opsCommands = (opsScope.payload.commands ?? []).map((command) => command.command);
  assert(!opsCommands.includes('start'), 'Ops chat scope should not advertise /start');
  assert(opsCommands.includes('help'), 'Ops chat scope should advertise /help');
  assert(opsCommands.includes('status'), 'Ops chat scope should advertise /status');
  assert(!opsCommands.includes('backup'), 'Read-only smoke should not advertise /backup');
  assert(!opsCommands.includes('drill'), 'Read-only smoke should not advertise /drill');
  assert(!opsCommands.includes('approve'), 'Polling smoke should not advertise /approve');
}

assert((metadata.shortDescriptions ?? []).length === 1, 'Expected one short description sync call');
assert((metadata.descriptions ?? []).length === 1, 'Expected one description sync call');
assert((metadata.menuButtons ?? []).length === 1, 'Expected one menu button sync call');

const statusMessages = sentMessages.filter((entry) =>
  String(entry?.payload?.text ?? '').includes('Ops Status:'),
);
assert(statusMessages.length === 1, `Expected exactly 1 /status response (startup replay guard), got ${statusMessages.length}`);

const opMessages = sentMessages.filter((entry) => String(entry?.payload?.text ?? '').includes('Action status'));
assert(opMessages.length === 1, `Expected exactly 1 /op response, got ${opMessages.length}`);

if (statusMessages[0]) {
  assert(
    String(statusMessages[0].payload.chat_id) === String(process.env.EXPECTED_CHAT_ID),
    'Status response chat_id mismatch',
  );
  assert(
    statusMessages[0].payload.message_thread_id === opsThread,
    'Status response should route to ops thread',
  );
}

if (opMessages[0]) {
  assert(
    opMessages[0].payload.message_thread_id === opsThread,
    'Op response should route to ops thread',
  );
  assert(
    String(opMessages[0].payload.text).includes(String(process.env.EXPECTED_OP_ID)),
    'Op response should include requested operation id',
  );
}

const shareCard = sentMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Homework Assignment: Quiet Reading Pack'),
);
assert(Boolean(shareCard), 'Missing /share assignment card message');
if (shareCard) {
  assert(shareCard.payload.message_thread_id === jobsThread, 'Share card should route to jobs thread');
  assert(String(shareCard.payload.text).includes('📘'), 'Share card should include fallback emoji from HTML');
}

const studyAudioMessage = sentMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Listen 1: Study Text'),
);
assert(Boolean(studyAudioMessage), 'Missing study audio message for /share');
if (studyAudioMessage) {
  assert(
    studyAudioMessage.payload.message_thread_id === jobsThread,
    'Study audio message should route to jobs thread',
  );
  assert(
    String(studyAudioMessage.payload.text).includes('/audio/final/'),
    'Study audio should resolve from markdown source',
  );
}

const pronunciationAudioMessage = sentMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Listen 2: Pronunciation'),
);
assert(Boolean(pronunciationAudioMessage), 'Missing pronunciation audio message for /share');
if (pronunciationAudioMessage) {
  assert(
    pronunciationAudioMessage.payload.message_thread_id === jobsThread,
    'Pronunciation audio message should route to jobs thread',
  );
  assert(
    String(pronunciationAudioMessage.payload.text).includes('/audio/pronunciation-shadow/'),
    'Pronunciation audio should resolve from HTML fallback',
  );
}

const opsStatusRequest = (backendState.requests ?? []).find((entry) => entry.path === '/ops/status');
assert(Boolean(opsStatusRequest), 'Fake backend did not receive /ops/status');
if (opsStatusRequest) {
  assert(
    opsStatusRequest.opsSecretHeader === 'smoke-secret',
    'Bot should forward x-ops-bot-secret for /ops endpoints',
  );
}

const jobRequest = (backendState.requests ?? []).find((entry) =>
  String(entry.path).startsWith('/jobs/'),
);
assert(Boolean(jobRequest), 'Fake backend did not receive /jobs/:id request for /share');

const result = {
  sentMessageCount: sentMessages.length,
  createdTopics,
  assertionsFailed: failures.length,
  failures,
};

fs.writeFileSync(
  `${process.env.STATE_PATH}.assertions.json`,
  JSON.stringify(result, null, 2),
  'utf8',
);

if (failures.length > 0) {
  console.error('Smoke assertions failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Smoke assertions passed');
NODE
