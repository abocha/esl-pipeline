#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ARTIFACT_DIR,
  loadEnvFromFiles,
  normalizeEnvValue,
  truncateText,
  writeJsonArtifact,
} from './telegram-ops-go-live-utils.mjs';

const DEFAULT_JSON_OUT = path.join(DEFAULT_ARTIFACT_DIR, 'verify.json');

function printUsage() {
  console.log(
    'Usage: node scripts/release/telegram-ops-go-live-verify.mjs [--backend-url <url>] [--email <email>] [--password <password>] [--shared-secret <secret>] [--operation-id <id>] [--timeout-ms <ms>] [--json-out <path>]',
  );
}

function parseArgs(argv) {
  const args = {
    backendUrl: '',
    email: '',
    password: '',
    sharedSecret: '',
    operationId: '',
    timeoutMs: 15_000,
    jsonOutPath: DEFAULT_JSON_OUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--backend-url') {
      args.backendUrl = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--backend-url=')) {
      args.backendUrl = token.slice('--backend-url='.length);
      continue;
    }
    if (token === '--email') {
      args.email = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--email=')) {
      args.email = token.slice('--email='.length);
      continue;
    }
    if (token === '--password') {
      args.password = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--password=')) {
      args.password = token.slice('--password='.length);
      continue;
    }
    if (token === '--shared-secret') {
      args.sharedSecret = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--shared-secret=')) {
      args.sharedSecret = token.slice('--shared-secret='.length);
      continue;
    }
    if (token === '--operation-id') {
      args.operationId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--operation-id=')) {
      args.operationId = token.slice('--operation-id='.length);
      continue;
    }
    if (token === '--timeout-ms') {
      args.timeoutMs = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
      continue;
    }
    if (token.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number.parseInt(token.slice('--timeout-ms='.length), 10);
      continue;
    }
    if (token === '--json-out') {
      args.jsonOutPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--json-out=')) {
      args.jsonOutPath = token.slice('--json-out='.length);
      continue;
    }
    if (token === '-h' || token === '--help') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 120_000) {
    throw new Error('--timeout-ms must be an integer between 1000 and 120000');
  }
  if (!normalizeEnvValue(args.jsonOutPath)) {
    throw new Error('--json-out cannot be empty');
  }
  return args;
}

function createCheck({ id, passed, message, severity = 'error', details }) {
  return {
    id,
    passed: Boolean(passed),
    severity,
    message,
    details: details ?? {},
  };
}

function summarizeChecks(checks) {
  let failed = 0;
  let warnings = 0;
  for (const check of checks) {
    if (check.passed) {
      continue;
    }
    if (check.severity === 'warning') {
      warnings += 1;
      continue;
    }
    failed += 1;
  }
  return {
    total: checks.length,
    failed,
    warnings,
    passed: failed === 0,
  };
}

async function fetchWithTimeout(args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    return await args.fetchFn(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponsePayload(response) {
  const bodyText = await response.text();
  if (!bodyText) {
    return {
      json: null,
      text: '',
    };
  }

  const contentType = normalizeEnvValue(response.headers.get('content-type')).toLowerCase();
  if (!contentType.includes('application/json')) {
    return {
      json: null,
      text: bodyText,
    };
  }
  try {
    return {
      json: JSON.parse(bodyText),
      text: '',
    };
  } catch {
    return {
      json: null,
      text: bodyText,
    };
  }
}

function normalizeBackendUrl(input) {
  const raw = normalizeEnvValue(input);
  if (!raw) {
    return '';
  }
  const trimmed = raw.replace(/\/+$/u, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'batch-backend') {
      parsed.hostname = '127.0.0.1';
      return parsed.toString().replace(/\/+$/u, '');
    }
  } catch {
    // Keep raw value for non-URL inputs.
  }
  return trimmed;
}

function withOpsSecretHeader(headers, sharedSecret) {
  if (!sharedSecret) {
    return headers;
  }
  return {
    ...headers,
    'x-ops-bot-secret': sharedSecret,
  };
}

async function login(args) {
  const response = await fetchWithTimeout({
    fetchFn: args.fetchFn,
    timeoutMs: args.timeoutMs,
    url: `${args.backendUrl}/auth/login`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: args.email,
      password: args.password,
    }),
  });
  const payload = await readResponsePayload(response);
  return {
    status: response.status,
    ...payload,
  };
}

async function requestJson(args) {
  const response = await fetchWithTimeout({
    fetchFn: args.fetchFn,
    timeoutMs: args.timeoutMs,
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
  });
  const payload = await readResponsePayload(response);
  return {
    status: response.status,
    ...payload,
  };
}

function statusShapeValid(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const value = payload;
  return (
    typeof value.checkedAtUtc === 'string' &&
    Boolean(
      value.overall && typeof value.overall === 'object' && typeof value.overall.state === 'string',
    )
  );
}

export async function runVerification(args = {}) {
  const env = args.env ?? (await loadEnvFromFiles());
  const backendUrl = normalizeBackendUrl(args.backendUrl || env.TELEGRAM_OPS_BOT_BACKEND_URL);
  const email = normalizeEnvValue(args.email || env.TELEGRAM_OPS_BOT_BACKEND_EMAIL);
  const password = normalizeEnvValue(args.password || env.TELEGRAM_OPS_BOT_BACKEND_PASSWORD);
  const sharedSecret = normalizeEnvValue(
    args.sharedSecret ||
      env.TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET ||
      env.BATCH_BACKEND_OPS_CONTROL_BOT_SECRET,
  );
  const operationId = normalizeEnvValue(args.operationId);
  const timeoutMs = args.timeoutMs ?? 15_000;
  const fetchFn = args.fetchFn ?? fetch;
  const jsonOutPath = args.jsonOutPath ?? DEFAULT_JSON_OUT;

  const checks = [];
  const traces = {};

  checks.push(
    createCheck({
      id: 'backend_url_configured',
      passed: backendUrl.length > 0,
      message: 'Backend URL must be configured.',
      details: {
        value: backendUrl || '(empty)',
      },
    }),
    createCheck({
      id: 'backend_credentials_configured',
      passed: email.length > 0 && password.length > 0,
      message: 'Backend service-account credentials must be configured.',
      details: {
        emailConfigured: email.length > 0,
        passwordConfigured: password.length > 0,
      },
    }),
  );

  if (checks.some((check) => !check.passed && check.severity !== 'warning')) {
    const summary = summarizeChecks(checks);
    const report = {
      kind: 'telegram_ops_go_live_verify',
      version: 1,
      generatedAt: new Date().toISOString(),
      summary,
      checks,
      traces,
    };
    const artifactPath = await writeJsonArtifact(jsonOutPath, report);
    return {
      report: {
        ...report,
        artifactPath,
      },
      exitCode: 1,
    };
  }

  const loginResult = await login({
    backendUrl,
    email,
    password,
    timeoutMs,
    fetchFn,
  });
  traces.login = {
    status: loginResult.status,
    body: loginResult.json
      ? truncateText(JSON.stringify(loginResult.json))
      : truncateText(loginResult.text),
  };
  const accessToken =
    loginResult.status === 200 &&
    loginResult.json &&
    typeof loginResult.json === 'object' &&
    typeof loginResult.json.accessToken === 'string'
      ? loginResult.json.accessToken
      : '';

  checks.push(
    createCheck({
      id: 'auth_login_success',
      passed: accessToken.length > 0,
      message: 'POST /auth/login must succeed and return accessToken.',
      details: {
        status: loginResult.status,
      },
    }),
  );

  if (accessToken) {
    const authHeaders = {
      authorization: `Bearer ${accessToken}`,
    };

    const statusResult = await requestJson({
      fetchFn,
      timeoutMs,
      method: 'GET',
      url: `${backendUrl}/ops/status`,
      headers: withOpsSecretHeader(authHeaders, sharedSecret),
    });
    traces.opsStatus = {
      status: statusResult.status,
      body: statusResult.json
        ? truncateText(JSON.stringify(statusResult.json))
        : truncateText(statusResult.text),
    };
    checks.push(
      createCheck({
        id: 'ops_status_success_shape',
        passed: statusResult.status === 200 && statusShapeValid(statusResult.json),
        message: 'GET /ops/status must return 200 with expected payload shape.',
        details: {
          status: statusResult.status,
        },
      }),
    );

    if (sharedSecret) {
      const missingSecretResult = await requestJson({
        fetchFn,
        timeoutMs,
        method: 'GET',
        url: `${backendUrl}/ops/status`,
        headers: authHeaders,
      });
      traces.opsStatusMissingSecret = {
        status: missingSecretResult.status,
        body: missingSecretResult.json
          ? truncateText(JSON.stringify(missingSecretResult.json))
          : truncateText(missingSecretResult.text),
      };
      checks.push(
        createCheck({
          id: 'ops_secret_enforcement_missing_header',
          passed:
            missingSecretResult.status === 403 &&
            missingSecretResult.json &&
            missingSecretResult.json.code === 'ops_bot_secret_invalid',
          message:
            'When shared secret is configured, /ops/status without x-ops-bot-secret must return 403 ops_bot_secret_invalid.',
          details: {
            status: missingSecretResult.status,
          },
        }),
      );

      const wrongSecretResult = await requestJson({
        fetchFn,
        timeoutMs,
        method: 'GET',
        url: `${backendUrl}/ops/status`,
        headers: {
          ...authHeaders,
          'x-ops-bot-secret': `${sharedSecret}-wrong`,
        },
      });
      traces.opsStatusWrongSecret = {
        status: wrongSecretResult.status,
        body: wrongSecretResult.json
          ? truncateText(JSON.stringify(wrongSecretResult.json))
          : truncateText(wrongSecretResult.text),
      };
      checks.push(
        createCheck({
          id: 'ops_secret_enforcement_wrong_header',
          passed:
            wrongSecretResult.status === 403 &&
            wrongSecretResult.json &&
            wrongSecretResult.json.code === 'ops_bot_secret_invalid',
          message:
            'When shared secret is configured, /ops/status with wrong x-ops-bot-secret must return 403 ops_bot_secret_invalid.',
          details: {
            status: wrongSecretResult.status,
          },
        }),
      );
    } else {
      checks.push(
        createCheck({
          id: 'ops_secret_enforcement_skipped',
          passed: false,
          severity: 'warning',
          message: 'Shared secret not configured; secret-enforcement checks skipped.',
        }),
      );
    }

    const unknownOperationId = `verify-missing-${Date.now()}`;
    const missingActionResult = await requestJson({
      fetchFn,
      timeoutMs,
      method: 'GET',
      url: `${backendUrl}/ops/actions/${unknownOperationId}`,
      headers: withOpsSecretHeader(authHeaders, sharedSecret),
    });
    traces.unknownOperation = {
      operationId: unknownOperationId,
      status: missingActionResult.status,
      body: missingActionResult.json
        ? truncateText(JSON.stringify(missingActionResult.json))
        : truncateText(missingActionResult.text),
    };
    checks.push(
      createCheck({
        id: 'ops_action_not_found_semantics',
        passed:
          missingActionResult.status === 404 &&
          missingActionResult.json &&
          missingActionResult.json.error === 'not_found' &&
          missingActionResult.json.code === 'ops_action_not_found',
        message:
          'GET /ops/actions/:operationId for unknown id must return 404 not_found with code ops_action_not_found.',
        details: {
          status: missingActionResult.status,
        },
      }),
    );

    if (operationId) {
      const operationLookupResult = await requestJson({
        fetchFn,
        timeoutMs,
        method: 'GET',
        url: `${backendUrl}/ops/actions/${operationId}`,
        headers: withOpsSecretHeader(authHeaders, sharedSecret),
      });
      traces.operationLookup = {
        operationId,
        status: operationLookupResult.status,
        body: operationLookupResult.json
          ? truncateText(JSON.stringify(operationLookupResult.json))
          : truncateText(operationLookupResult.text),
      };
      checks.push(
        createCheck({
          id: 'operation_id_lookup_available',
          passed:
            operationLookupResult.status === 200 &&
            operationLookupResult.json &&
            operationLookupResult.json.operationId === operationId,
          message:
            'GET /ops/actions/<operationId> must return 200 and the same operationId for provided continuity check id.',
          details: {
            status: operationLookupResult.status,
            operationId,
          },
        }),
      );
    } else {
      checks.push(
        createCheck({
          id: 'operation_id_lookup_skipped',
          passed: false,
          severity: 'warning',
          message:
            'No --operation-id provided; restart continuity lookup check skipped for this run.',
        }),
      );
    }
  }

  const summary = summarizeChecks(checks);
  const report = {
    kind: 'telegram_ops_go_live_verify',
    version: 1,
    generatedAt: new Date().toISOString(),
    summary,
    checks,
    traces,
  };
  const artifactPath = await writeJsonArtifact(jsonOutPath, report);
  return {
    report: {
      ...report,
      artifactPath,
    },
    exitCode: summary.passed ? 0 : 1,
  };
}

function printReport(report) {
  console.log('[telegram-ops-go-live-verify]');
  console.log(`- artifact: ${report.artifactPath}`);
  for (const check of report.checks) {
    if (check.passed) {
      console.log(`PASS ${check.id}: ${check.message}`);
      continue;
    }
    const prefix = check.severity === 'warning' ? 'WARN' : 'FAIL';
    console.log(`${prefix} ${check.id}: ${check.message}`);
  }
  console.log(
    `- summary: passed=${report.summary.passed} failed=${report.summary.failed} warnings=${report.summary.warnings}`,
  );
}

async function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[telegram-ops-go-live-verify] error: ${error instanceof Error ? error.message : String(error)}`,
    );
    printUsage();
    process.exit(1);
  }

  const result = await runVerification(parsedArgs);
  printReport(result.report);
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(
      `[telegram-ops-go-live-verify] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exit(1);
  });
}

export { DEFAULT_JSON_OUT, normalizeBackendUrl, parseArgs, readResponsePayload };
