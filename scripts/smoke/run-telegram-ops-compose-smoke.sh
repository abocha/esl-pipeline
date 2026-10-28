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
created_env_file=0

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

wait_for_answered_callbacks() {
  local expected_count="$1"
  local timeout_seconds="${2:-120}"
  local attempt=1

  while (( attempt <= timeout_seconds )); do
    if curl -fsS "${API_URL}/_test/state" | EXPECTED_COUNT="${expected_count}" node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); const n=(s.answeredCallbacks||[]).length; process.exit(n>=Number(process.env.EXPECTED_COUNT)?0:1);" ; then
      return 0
    fi

    sleep 1
    attempt=$((attempt + 1))
  done

  echo "ERROR: expected at least ${expected_count} answered callbacks, timeout reached" >&2
  return 1
}

count_sent_messages() {
  curl -fsS "${API_URL}/_test/state" | node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(String((s.sentMessages||[]).length));"
}

cleanup() {
  local exit_code="$?"
  set +e

  compose ps >"${ARTIFACT_DIR}/compose-ps.txt" 2>&1
  compose logs --no-color >"${ARTIFACT_DIR}/compose-logs.txt" 2>&1
  curl -fsS "${API_URL}/_test/state" >"${ARTIFACT_DIR}/telegram-api-state.json" 2>/dev/null
  curl -fsS "${BACKEND_URL}/_test/state" >"${ARTIFACT_DIR}/fake-backend-state.json" 2>/dev/null

  compose down --volumes --remove-orphans >"${ARTIFACT_DIR}/compose-down.txt" 2>&1
  if [[ "${created_env_file}" -eq 1 && ! -s "${ROOT_DIR}/.env" ]]; then
    rm -f "${ROOT_DIR}/.env"
  fi

  if [[ "${exit_code}" -eq 0 ]]; then
    echo "Telegram compose smoke completed successfully. Artifacts: ${ARTIFACT_DIR}"
  else
    echo "Telegram compose smoke failed. Artifacts: ${ARTIFACT_DIR}" >&2
  fi

  exit "${exit_code}"
}
trap cleanup EXIT

# Compose also reads env_file entries from non-smoke services when collecting logs
# and tearing down. A clean CI checkout has no .env; never replace a developer's file.
if [[ ! -e "${ROOT_DIR}/.env" ]]; then
  (set -o noclobber; : >"${ROOT_DIR}/.env")
  created_env_file=1
fi

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

wait_for_topics_ready 120

OPS_THREAD="$(curl -fsS "${API_URL}/_test/state" | node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); const topic=(s.createdTopics||[]).find((entry)=>entry.name==='Ops Control'); if (!topic) process.exit(1); process.stdout.write(String(topic.message_thread_id));")"

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
        "message_thread_id": ${OPS_THREAD},
        "text": "/help"
      }
    }
  ]
}
JSON

wait_for_messages 1

PANEL_MESSAGE_ID="$(curl -fsS "${API_URL}/_test/state" | node -e "const fs=require('node:fs'); const s=JSON.parse(fs.readFileSync(0,'utf8')); const first=(s.sentMessages||[])[0]; if (!first) process.exit(1); process.stdout.write(String(first.message_id));")"

cat <<JSON | curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/enqueue-updates" -d @- >/dev/null
{
  "updates": [
    {
      "update_id": 302,
      "callback_query": {
        "id": "cb-status",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|s",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    },
    {
      "update_id": 303,
      "callback_query": {
        "id": "cb-recent",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|r",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    },
    {
      "update_id": 304,
      "callback_query": {
        "id": "cb-op",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|o|${SMOKE_OP_ID}",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    },
    {
      "update_id": 305,
      "callback_query": {
        "id": "cb-finished",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|f",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    },
    {
      "update_id": 306,
      "callback_query": {
        "id": "cb-job",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|j|${SMOKE_SHARE_JOB_ID}",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    },
    {
      "update_id": 307,
      "callback_query": {
        "id": "cb-share",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|js|${SMOKE_SHARE_JOB_ID}",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    }
  ]
}
JSON

wait_for_answered_callbacks 6
SENT_MESSAGES_BEFORE_FALLBACK="$(count_sent_messages)"
curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/fail-next-edit" -d '{}' >/dev/null

cat <<JSON | curl -fsS -X POST -H 'Content-Type: application/json' "${API_URL}/_test/enqueue-updates" -d @- >/dev/null
{
  "updates": [
    {
      "update_id": 308,
      "callback_query": {
        "id": "cb-status-fallback",
        "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
        "data": "a4|s",
        "message": {
          "message_id": ${PANEL_MESSAGE_ID},
          "date": ${now_epoch},
          "message_thread_id": ${OPS_THREAD},
          "chat": {"id": ${SMOKE_CHAT_ID}, "type": "supergroup", "title": "Smoke Ops Chat", "is_forum": true},
          "from": {"id": ${SMOKE_ALLOWED_USER_ID}, "is_bot": false, "first_name": "Smoke Operator"},
          "text": "/help"
        }
      }
    }
  ]
}
JSON

wait_for_answered_callbacks 7
wait_for_messages "$((SENT_MESSAGES_BEFORE_FALLBACK + 1))"

curl -fsS "${API_URL}/_test/state" >"${ARTIFACT_DIR}/telegram-api-state.final.json"
curl -fsS "${BACKEND_URL}/_test/state" >"${ARTIFACT_DIR}/fake-backend-state.final.json"

STATE_PATH="${ARTIFACT_DIR}/telegram-api-state.final.json" \
BACKEND_STATE_PATH="${ARTIFACT_DIR}/fake-backend-state.final.json" \
EXPECTED_CHAT_ID="${SMOKE_CHAT_ID}" \
EXPECTED_OP_ID="${SMOKE_OP_ID}" \
EXPECTED_SHARE_JOB_ID="${SMOKE_SHARE_JOB_ID}" \
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
const editedMessages = state.editedMessages ?? [];
const answeredCallbacks = state.answeredCallbacks ?? [];
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
  assert(!opsCommands.includes('integrity'), 'Read-only smoke should not advertise /integrity');
  assert(!opsCommands.includes('approve'), 'Polling smoke should not advertise /approve');
}

assert((metadata.shortDescriptions ?? []).length === 1, 'Expected one short description sync call');
assert((metadata.descriptions ?? []).length === 1, 'Expected one description sync call');
assert((metadata.menuButtons ?? []).length === 1, 'Expected one menu button sync call');

const helpPanel = sentMessages[0];
assert(Boolean(helpPanel), 'Missing guided /help panel message');
if (helpPanel) {
  assert(
    String(helpPanel.payload.chat_id) === String(process.env.EXPECTED_CHAT_ID),
    'Help panel chat_id mismatch',
  );
  assert(
    helpPanel.payload.message_thread_id === opsThread,
    'Help panel should route to ops thread',
  );
  assert(
    Array.isArray(helpPanel.payload.reply_markup?.inline_keyboard) &&
      helpPanel.payload.reply_markup.inline_keyboard.length > 0,
    'Help panel should include inline keyboard controls',
  );
}

assert(answeredCallbacks.length >= 7, `Expected at least 7 answered callbacks, got ${answeredCallbacks.length}`);

const statusEdit = editedMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Ops Status:'),
);
assert(Boolean(statusEdit), 'Missing callback-driven status edit');
assert(
  String(statusEdit?.payload?.text ?? '').includes('2026-03-13 12:15 Asia/Ho_Chi_Minh'),
  'Status should use the configured workspace tutor timezone',
);

const recentOpsEdit = editedMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Recent operations'),
);
assert(Boolean(recentOpsEdit), 'Missing callback-driven recent operations edit');

const opEdit = editedMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes(String(process.env.EXPECTED_OP_ID)),
);
assert(Boolean(opEdit), 'Missing callback-driven operation detail edit');

const finishedJobsEdit = editedMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Jobs · Recent Finished'),
);
assert(Boolean(finishedJobsEdit), 'Missing callback-driven finished jobs edit');
assert(
  String(finishedJobsEdit?.payload?.text ?? '').includes('2026-03-13 12:10 Asia/Ho_Chi_Minh'),
  'Finished jobs should use the configured workspace tutor timezone',
);

const jobDetailEdit = editedMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes(String(process.env.EXPECTED_SHARE_JOB_ID)),
);
assert(Boolean(jobDetailEdit), 'Missing callback-driven job detail edit');

const fallbackStatusMessage = sentMessages.find(
  (entry, index) =>
    index > 0 && String(entry?.payload?.text ?? '').includes('Ops Status:'),
);
assert(Boolean(fallbackStatusMessage), 'Missing replacement message after forced edit failure');
if (fallbackStatusMessage) {
  assert(
    fallbackStatusMessage.payload.message_thread_id === opsThread,
    'Fallback status message should stay in the ops thread',
  );
}

const shareCard = sentMessages.find((entry) =>
  String(entry?.payload?.text ?? '').includes('Homework Assignment: Quiet Reading Pack'),
);
assert(Boolean(shareCard), 'Missing /share assignment card message');
if (shareCard) {
  assert(shareCard.payload.message_thread_id === jobsThread, 'Share card should route to jobs thread');
  assert(String(shareCard.payload.text).includes('📘'), 'Share card should include durable publication emoji');
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
    'Study audio should resolve from durable publication metadata',
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
    String(pronunciationAudioMessage.payload.text).includes('/audio/pronunciation/'),
    'Pronunciation audio should resolve from durable publication metadata',
  );
}

const settingsRequests = (backendState.requests ?? []).filter((entry) => entry.path === '/business/settings');
assert(settingsRequests.length > 0, 'Fake backend did not receive workspace timezone settings lookup');
assert(
  settingsRequests.every((entry) => entry.method === 'GET' && entry.authHeader === 'Bearer smoke-access-token'),
  'Workspace timezone lookup should use the authenticated workspace',
);

const opsStatusRequest = (backendState.requests ?? []).find((entry) => entry.path === '/ops/status');
assert(Boolean(opsStatusRequest), 'Fake backend did not receive /ops/status');
if (opsStatusRequest) {
  assert(
    opsStatusRequest.opsSecretHeader === 'smoke-secret',
    'Bot should forward x-ops-bot-secret for /ops endpoints',
  );
}

const opsListRequest = (backendState.requests ?? []).find((entry) => entry.path === '/ops/actions');
assert(Boolean(opsListRequest), 'Fake backend did not receive /ops/actions list request');

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
