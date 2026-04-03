import http from 'node:http';

const token = process.env.TELEGRAM_SMOKE_TOKEN ?? '123456789:smoke-token';
const chatIdRaw = process.env.TELEGRAM_SMOKE_CHAT_ID ?? '-1001234567890';
const allowedUserId = Number(process.env.TELEGRAM_SMOKE_ALLOWED_USER_ID ?? '12345678');

const host = process.env.TELEGRAM_SMOKE_API_HOST ?? '0.0.0.0';
const port = Number(process.env.TELEGRAM_SMOKE_API_PORT ?? '18080');

const numericChatId = Number(chatIdRaw);
const chatId = Number.isFinite(numericChatId) ? numericChatId : chatIdRaw;

const predefinedTopics = new Map([
  ['Ops Control', 9101],
  ['Jobs', 9201],
  ['Alerts', 9301],
]);

const state = {
  expectedToken: token,
  chatId: chatIdRaw,
  allowedUserId,
  updates: [],
  sentMessages: [],
  editedMessages: [],
  answeredCallbacks: [],
  createdTopics: [],
  failNextEdit: false,
  calls: {
    getMe: 0,
    getUpdates: 0,
    getChat: 0,
    createForumTopic: 0,
    sendMessage: 0,
    editMessageText: 0,
    answerCallbackQuery: 0,
    setMyCommands: 0,
    setMyDescription: 0,
    setMyShortDescription: 0,
    setChatMenuButton: 0,
  },
  metadata: {
    commands: [],
    descriptions: [],
    shortDescriptions: [],
    menuButtons: [],
  },
  getUpdatesRequests: [],
  nextMessageId: 50_000,
  nextUpdateId: 1_000,
  nextTopicId: 9_500,
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function toSafeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed;
}

function normalizeUpdate(rawUpdate) {
  const updateId = Number.isInteger(rawUpdate?.update_id)
    ? rawUpdate.update_id
    : state.nextUpdateId++;
  if (rawUpdate?.callback_query) {
    return {
      update_id: updateId,
      callback_query: {
        id:
          typeof rawUpdate.callback_query.id === 'string'
            ? rawUpdate.callback_query.id
            : `cb-${updateId}`,
        from: {
          id: Number.isInteger(rawUpdate.callback_query?.from?.id)
            ? rawUpdate.callback_query.from.id
            : allowedUserId,
          is_bot: Boolean(rawUpdate.callback_query?.from?.is_bot ?? false),
          first_name: rawUpdate.callback_query?.from?.first_name ?? 'Smoke Operator',
          username: rawUpdate.callback_query?.from?.username ?? 'smoke_operator',
        },
        data:
          typeof rawUpdate.callback_query.data === 'string'
            ? rawUpdate.callback_query.data
            : 'a4|h',
        message: normalizeMessage(rawUpdate.callback_query.message),
      },
    };
  }

  return {
    update_id: updateId,
    message: normalizeMessage(rawUpdate.message),
  };
}

function normalizeMessage(rawMessage) {
  const message = {
    message_id: Number.isInteger(rawMessage?.message_id)
      ? rawMessage.message_id
      : state.nextMessageId++,
    date: Number.isInteger(rawMessage?.date) ? rawMessage.date : Math.floor(Date.now() / 1_000),
    chat: {
      id: Number.isInteger(rawMessage?.chat?.id) ? rawMessage.chat.id : chatId,
      type: rawMessage?.chat?.type ?? 'supergroup',
      title: rawMessage?.chat?.title ?? 'Smoke Ops Chat',
      is_forum: typeof rawMessage?.chat?.is_forum === 'boolean' ? rawMessage.chat.is_forum : true,
    },
    from: {
      id: Number.isInteger(rawMessage?.from?.id) ? rawMessage.from.id : allowedUserId,
      is_bot: Boolean(rawMessage?.from?.is_bot ?? false),
      first_name: rawMessage?.from?.first_name ?? 'Smoke Operator',
      username: rawMessage?.from?.username ?? 'smoke_operator',
    },
    text: typeof rawMessage?.text === 'string' ? rawMessage.text : '/status',
  };

  if (Number.isInteger(rawMessage?.message_thread_id)) {
    message.message_thread_id = rawMessage.message_thread_id;
  }

  return message;
}

function enqueueUpdates(rawUpdates) {
  for (const rawUpdate of rawUpdates) {
    state.updates.push(normalizeUpdate(rawUpdate));
  }
  state.updates.sort((a, b) => a.update_id - b.update_id);
  const latest = state.updates.at(-1);
  if (latest && latest.update_id >= state.nextUpdateId) {
    state.nextUpdateId = latest.update_id + 1;
  }
}

function apiSuccess(res, result) {
  sendJson(res, 200, {
    ok: true,
    result,
  });
}

function apiError(res, statusCode, description) {
  sendJson(res, statusCode, {
    ok: false,
    error_code: statusCode,
    description,
  });
}

async function handleTelegramMethod(_req, res, method, payload) {
  if (method === 'getMe') {
    state.calls.getMe += 1;
    apiSuccess(res, {
      id: 7_070_707,
      is_bot: true,
      first_name: 'ESL Smoke Bot',
      username: 'esl_ops_smoke_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    });
    return;
  }

  if (method === 'getUpdates') {
    state.calls.getUpdates += 1;
    const offset = toSafeInt(payload.offset, 0);
    const limit = Math.max(1, Math.min(100, toSafeInt(payload.limit, 100)));

    let result;
    if (offset === -1) {
      const latest = state.updates.at(-1);
      result = latest ? [latest] : [];
    } else {
      result = state.updates.filter((update) => update.update_id >= offset).slice(0, limit);
    }

    state.getUpdatesRequests.push({
      ts: new Date().toISOString(),
      offset,
      limit,
      timeout: toSafeInt(payload.timeout, null),
      returnedUpdateIds: result.map((update) => update.update_id),
    });
    apiSuccess(res, result);
    return;
  }

  if (method === 'getChat') {
    state.calls.getChat += 1;
    apiSuccess(res, {
      id: chatId,
      type: 'supergroup',
      title: 'Smoke Ops Chat',
      is_forum: true,
    });
    return;
  }

  if (method === 'createForumTopic') {
    state.calls.createForumTopic += 1;
    const topicName = typeof payload.name === 'string' ? payload.name.trim() : 'Unnamed Topic';
    let threadId = predefinedTopics.get(topicName);
    if (!threadId) {
      threadId = state.nextTopicId;
      state.nextTopicId += 1;
    }

    state.createdTopics.push({
      ts: new Date().toISOString(),
      chat_id: payload.chat_id,
      name: topicName,
      message_thread_id: threadId,
    });

    apiSuccess(res, {
      message_thread_id: threadId,
      name: topicName,
      icon_color: 7_322_096,
      icon_custom_emoji_id: undefined,
    });
    return;
  }

  if (method === 'sendMessage') {
    state.calls.sendMessage += 1;
    const messageThreadId = Number.isInteger(payload.message_thread_id)
      ? payload.message_thread_id
      : null;
    const messageId = state.nextMessageId++;
    state.sentMessages.push({
      ts: new Date().toISOString(),
      message_id: messageId,
      payload,
      message_thread_id: messageThreadId,
    });

    apiSuccess(res, {
      message_id: messageId,
      date: Math.floor(Date.now() / 1_000),
      chat: {
        id: chatId,
        type: 'supergroup',
        title: 'Smoke Ops Chat',
      },
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      text: typeof payload.text === 'string' ? payload.text : '',
    });
    return;
  }

  if (method === 'editMessageText') {
    state.calls.editMessageText += 1;
    if (state.failNextEdit) {
      state.failNextEdit = false;
      apiError(res, 400, "Bad Request: message can't be edited");
      return;
    }

    state.editedMessages.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, {
      message_id: Number.isInteger(payload.message_id) ? payload.message_id : state.nextMessageId++,
      date: Math.floor(Date.now() / 1_000),
      chat: {
        id: chatId,
        type: 'supergroup',
        title: 'Smoke Ops Chat',
      },
      text: typeof payload.text === 'string' ? payload.text : '',
    });
    return;
  }

  if (method === 'answerCallbackQuery') {
    state.calls.answerCallbackQuery += 1;
    state.answeredCallbacks.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, true);
    return;
  }

  if (method === 'setMyCommands') {
    state.calls.setMyCommands += 1;
    state.metadata.commands.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, true);
    return;
  }

  if (method === 'setMyDescription') {
    state.calls.setMyDescription += 1;
    state.metadata.descriptions.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, true);
    return;
  }

  if (method === 'setMyShortDescription') {
    state.calls.setMyShortDescription += 1;
    state.metadata.shortDescriptions.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, true);
    return;
  }

  if (method === 'setChatMenuButton') {
    state.calls.setChatMenuButton += 1;
    state.metadata.menuButtons.push({
      ts: new Date().toISOString(),
      payload,
    });
    apiSuccess(res, true);
    return;
  }

  apiError(res, 404, `Unsupported method: ${method}`);
}

async function handler(req, res) {
  const requestUrl = req.url ?? '/';

  if (req.method === 'GET' && requestUrl === '/_health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && requestUrl === '/_test/state') {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST' && requestUrl === '/_test/reset') {
    state.updates = [];
    state.sentMessages = [];
    state.editedMessages = [];
    state.answeredCallbacks = [];
    state.createdTopics = [];
    state.failNextEdit = false;
    state.calls = {
      getMe: 0,
      getUpdates: 0,
      getChat: 0,
      createForumTopic: 0,
      sendMessage: 0,
      editMessageText: 0,
      answerCallbackQuery: 0,
      setMyCommands: 0,
      setMyDescription: 0,
      setMyShortDescription: 0,
      setChatMenuButton: 0,
    };
    state.metadata = {
      commands: [],
      descriptions: [],
      shortDescriptions: [],
      menuButtons: [],
    };
    state.getUpdatesRequests = [];
    state.nextMessageId = 50_000;
    state.nextUpdateId = 1_000;
    state.nextTopicId = 9_500;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && requestUrl === '/_test/fail-next-edit') {
    state.failNextEdit = true;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && requestUrl === '/_test/enqueue-updates') {
    let payload;
    try {
      payload = await parseBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }

    if (!payload || !Array.isArray(payload.updates)) {
      sendJson(res, 400, { ok: false, error: 'Body must include updates[]' });
      return;
    }

    enqueueUpdates(payload.updates);
    sendJson(res, 200, {
      ok: true,
      totalUpdates: state.updates.length,
      lastUpdateId: state.updates.at(-1)?.update_id ?? null,
    });
    return;
  }

  if (req.method !== 'POST') {
    apiError(res, 405, 'Method Not Allowed');
    return;
  }

  const match = requestUrl.match(/^\/bot([^/]+)\/([^/?#]+)$/);
  if (!match) {
    apiError(res, 404, 'Unknown Telegram method path');
    return;
  }

  const requestToken = match[1] ?? '';
  const method = match[2] ?? '';
  if (requestToken !== token) {
    apiError(res, 401, 'Unauthorized bot token');
    return;
  }

  let payload = {};
  try {
    payload = await parseBody(req);
  } catch {
    apiError(res, 400, 'Invalid JSON body');
    return;
  }

  await handleTelegramMethod(req, res, method, payload);
}

const server = http.createServer((req, res) => {
  void handler(req, res).catch((error) => {
    console.error('[telegram-smoke-api] request failure', error);
    sendText(res, 500, 'internal error');
  });
});

server.listen(port, host, () => {
  console.log(`[telegram-smoke-api] listening on ${host}:${port}`);
});

const shutdown = () => {
  console.log('[telegram-smoke-api] shutting down');
  server.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
