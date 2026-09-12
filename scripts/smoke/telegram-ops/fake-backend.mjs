import http from 'node:http';

const host = process.env.TELEGRAM_SMOKE_BACKEND_HOST ?? '0.0.0.0';
const port = Number(process.env.TELEGRAM_SMOKE_BACKEND_PORT ?? '18081');
const expectedSecret = process.env.TELEGRAM_SMOKE_BACKEND_SECRET ?? 'smoke-secret';
const expectedEmail = process.env.TELEGRAM_SMOKE_BACKEND_EMAIL ?? 'ops-bot@example.com';
const expectedPassword = process.env.TELEGRAM_SMOKE_BACKEND_PASSWORD ?? 'smoke-password';
const defaultShareJobId = process.env.TELEGRAM_SMOKE_SHARE_JOB_ID ?? 'job-smoke-1';

const ACCESS_TOKEN = 'smoke-access-token';
const REFRESH_COOKIE = 'refreshToken=smoke-refresh-token';

const state = {
  requests: [],
  auth: {
    loginCalls: 0,
    refreshCalls: 0,
  },
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
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

function unauthorized(res, message = 'Unauthorized') {
  sendJson(res, 401, { message });
}

function forbidden(res, message = 'Forbidden') {
  sendJson(res, 403, { message });
}

function isAuthorized(headers) {
  const auth = headers.authorization;
  return auth === `Bearer ${ACCESS_TOKEN}`;
}

function hasExpectedOpsSecret(headers) {
  const provided = headers['x-ops-bot-secret'];
  return typeof provided === 'string' && provided === expectedSecret;
}

function nowIso() {
  return new Date().toISOString();
}

function buildOpsStatus() {
  return {
    checkedAtUtc: '2026-03-13T05:15:00.000Z',
    overall: {
      state: 'healthy',
      reasons: ['Smoke checks green'],
    },
    thresholds: {
      backupMaxAgeHours: 26,
      integrityMaxAgeDays: 8,
      drillMaxAgeDays: 35,
    },
    backup: {
      state: 'healthy',
      reason: 'Latest dump age within threshold',
      latestDumpKey: 'backups/postgres/esl_batch/smoke-latest.dump',
      lastModifiedUtc: '2026-03-13T04:50:00.000Z',
      ageHours: 0.42,
    },
    artifactIntegrity: {
      state: 'healthy',
      reason: 'Remote dump download and checksum verified',
      lastReportUtc: '2026-03-13T04:55:00.000Z',
      ageDays: 0,
      reportStatus: 'ok',
      remoteDumpKey: 'backups/postgres/esl_batch/smoke-latest.dump',
      result: 'download_checksum_verified',
      checksumVerified: true,
    },
    restoreDrill: {
      state: 'healthy',
      reason: 'Most recent drill succeeded',
      lastReportUtc: '2026-03-12T22:00:00.000Z',
      ageDays: 0.3,
      reportStatus: 'ok',
      remoteDumpKey: 'backups/postgres/esl_batch/smoke-latest.dump',
      result: 'restore_schema_and_reads_verified',
      postgresVersion: '18.6',
      restoreVerified: true,
      cleanupStatus: 'removed',
      publicTableCount: 42,
      schemaMigrationCount: 50,
    },
  };
}

function buildOpsActionStatus(operationId) {
  return {
    operationId,
    action: 'backup_upload',
    state: 'succeeded',
    requestedAt: '2026-03-13T05:16:00.000Z',
    startedAt: '2026-03-13T05:16:10.000Z',
    finishedAt: '2026-03-13T05:16:40.000Z',
    requestedBy: 'telegram-smoke-bot',
    requestedByUserId: '12345678',
    message: 'Backup upload completed',
    command: 'bash scripts/docker/postgres-backup-s3.sh backup-upload',
    exitCode: 0,
    stdoutTail: 'upload complete',
    stderrTail: null,
  };
}

function buildOpsActionList() {
  return {
    actions: [
      buildOpsActionStatus(process.env.TELEGRAM_SMOKE_OP_ID ?? 'smoke-op-1'),
      {
        ...buildOpsActionStatus('smoke-op-older'),
        action: 'restore_drill_download_only',
        state: 'running',
        requestedAt: '2026-03-13T04:50:00.000Z',
        startedAt: '2026-03-13T04:51:00.000Z',
        finishedAt: null,
        message: 'Drill still running',
        command: 'bash scripts/docker/postgres-backup-restore.sh drill-download-only',
        exitCode: null,
      },
    ],
    total: 2,
    limit: 10,
    offset: 0,
  };
}

function buildJob(jobId) {
  const safeJobId = typeof jobId === 'string' && jobId.trim() ? jobId.trim() : defaultShareJobId;
  return {
    jobId: safeJobId,
    studentId: 'student-smoke',
    md: [
      '## Student homework package',
      '',
      '[Audio recording: Study Text](https://cdn.smoke.example/audio/final/smoke-study.mp3)',
      '',
      'Pronunciation track intentionally omitted in markdown to validate HTML fallback.',
    ].join('\n'),
    mdStorageUri: null,
    recordingId: 'recording-smoke-1',
    transcriptId: 'transcript-smoke-1',
    promptPackageId: 'prompt-smoke-1',
    draftId: 'draft-smoke-1',
    preset: 'homework-a2',
    learningPresetId: 'homework-a2',
    learningPresetVersion: '1.0.0',
    promptSnapshotVersion: '2026-03-13',
    promptAlias: null,
    withTts: true,
    voiceId: 'voice-smoke',
    upload: 'none',
    voiceAccent: 'neutral',
    forceTts: false,
    publishTarget: 'html',
    ttsStrategy: 'tts',
    ttsProvider: 'google',
    googleTtsModel: 'neural2',
    autoPublish: true,
    htmlUrl: `http://telegram-smoke-backend:${port}/share/${encodeURIComponent(safeJobId)}`,
    state: 'succeeded',
    createdAt: '2026-03-13T05:00:00.000Z',
    updatedAt: '2026-03-13T05:17:00.000Z',
    startedAt: '2026-03-13T05:01:00.000Z',
    finishedAt: '2026-03-13T05:10:00.000Z',
    sourceJobId: null,
    error: null,
    providerError: null,
    manifestPath: '/app/uploads/manifests/smoke-manifest.json',
  };
}

function buildShareHtml(jobId) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <title>Homework Assignment: Quiet Reading Pack (${jobId})</title>`,
    '  </head>',
    '  <body>',
    '    <div class="hero-emoji">📘</div>',
    '    <h1>Quiet Reading Pack</h1>',
    '    <p>Fallback pronunciation audio link:</p>',
    '    <a href="https://cdn.smoke.example/audio/pronunciation/smoke-pronunciation.mp3">Pronunciation</a>',
    '  </body>',
    '</html>',
  ].join('\n');
}

async function handler(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  state.requests.push({
    ts: nowIso(),
    method: req.method,
    path: pathname,
    authHeader: req.headers.authorization ?? null,
    opsSecretHeader: req.headers['x-ops-bot-secret'] ?? null,
  });

  if (req.method === 'GET' && pathname === '/_health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/_test/state') {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/login') {
    let payload;
    try {
      payload = await parseBody(req);
    } catch {
      sendJson(res, 400, { message: 'Invalid JSON body' });
      return;
    }

    state.auth.loginCalls += 1;
    if (payload.email !== expectedEmail || payload.password !== expectedPassword) {
      unauthorized(res, 'Invalid credentials');
      return;
    }

    sendJson(
      res,
      200,
      {
        accessToken: ACCESS_TOKEN,
        expiresIn: 3600,
      },
      {
        'Set-Cookie': `${REFRESH_COOKIE}; Path=/; HttpOnly`,
      },
    );
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/refresh') {
    state.auth.refreshCalls += 1;
    if (!String(req.headers.cookie ?? '').includes(REFRESH_COOKIE)) {
      unauthorized(res, 'Missing refresh cookie');
      return;
    }
    sendJson(res, 200, {
      accessToken: ACCESS_TOKEN,
      expiresIn: 3600,
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/share/')) {
    const jobId = decodeURIComponent(pathname.replace('/share/', '') || defaultShareJobId);
    sendHtml(res, 200, buildShareHtml(jobId));
    return;
  }

  if (pathname.startsWith('/ops/')) {
    if (!isAuthorized(req.headers)) {
      unauthorized(res);
      return;
    }
    if (!hasExpectedOpsSecret(req.headers)) {
      forbidden(res, 'Invalid x-ops-bot-secret');
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/ops/status') {
    sendJson(res, 200, buildOpsStatus());
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/ops/actions/')) {
    const operationId = decodeURIComponent(pathname.replace('/ops/actions/', '') || 'smoke-op-1');
    sendJson(res, 200, buildOpsActionStatus(operationId));
    return;
  }

  if (req.method === 'GET' && pathname === '/ops/actions') {
    sendJson(res, 200, buildOpsActionList());
    return;
  }

  if (req.method === 'POST' && pathname === '/ops/actions') {
    if (!isAuthorized(req.headers)) {
      unauthorized(res);
      return;
    }
    if (!hasExpectedOpsSecret(req.headers)) {
      forbidden(res, 'Invalid x-ops-bot-secret');
      return;
    }

    const operationId = `smoke-queued-${Date.now()}`;
    sendJson(res, 200, {
      ...buildOpsActionStatus(operationId),
      state: 'queued',
      startedAt: null,
      finishedAt: null,
      message: 'Queued for execution',
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/jobs/')) {
    if (!isAuthorized(req.headers)) {
      unauthorized(res);
      return;
    }

    const jobId = decodeURIComponent(pathname.replace('/jobs/', '') || defaultShareJobId);
    sendJson(res, 200, buildJob(jobId));
    return;
  }

  if (req.method === 'GET' && pathname === '/admin/jobs') {
    if (!isAuthorized(req.headers)) {
      unauthorized(res);
      return;
    }
    sendJson(res, 200, {
      jobs: [buildJob(defaultShareJobId)],
      total: 1,
      limit: 10,
      offset: 0,
    });
    return;
  }

  sendJson(res, 404, { message: `Unhandled route ${req.method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  void handler(req, res);
});

server.listen(port, host, () => {
  console.log(`[telegram-smoke-backend] listening on ${host}:${port}`);
});

const shutdown = () => {
  console.log('[telegram-smoke-backend] shutting down');
  server.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
