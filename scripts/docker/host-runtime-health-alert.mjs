#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  collectQueueObservation,
  evaluateQueueObservation,
  normalizeQueueHistory,
} from './worker-queue-observation.mjs';

const REQUIRED_SERVICES = [
  'postgres',
  'redis',
  'batch-backend',
  'batch-frontend',
  'batch-worker',
  'transcribe-worker',
  'student-memory-worker',
];
const MEBIBYTE = 1024 * 1024;
const DOCKER_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_STATE_FILE = '/var/lib/esl-pipeline/ops/state/host-runtime-health-alert-state.json';

function truthy(value) {
  return /^(1|true|yes|on)$/iu.test(value ?? '');
}

function parseThreshold(env, name, fallback, errors) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${name} must be a non-negative number`);
    return fallback;
  }
  return parsed;
}

export function hostHealthConfig(env = process.env) {
  const errors = [];
  const warnDiskMb = parseThreshold(env, 'ESL_HOST_HEALTH_DISK_WARN_MB', 4096, errors);
  const deployDiskMinimumMb =
    env.ESL_HOST_HEALTH_DISK_CRITICAL_MB === undefined
      ? parseThreshold(env, 'DEPLOY_MIN_FREE_MB', 2048, errors)
      : 2048;
  const criticalDiskMb = parseThreshold(
    env,
    'ESL_HOST_HEALTH_DISK_CRITICAL_MB',
    deployDiskMinimumMb,
    errors,
  );
  const warnMemoryPercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_MEMORY_AVAILABLE_WARN_PERCENT',
    15,
    errors,
  );
  const criticalMemoryPercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_MEMORY_AVAILABLE_CRITICAL_PERCENT',
    8,
    errors,
  );
  const warnMemoryPsiSomePercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_MEMORY_PSI_SOME_WARN_PERCENT',
    10,
    errors,
  );
  const criticalMemoryPsiFullPercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_MEMORY_PSI_FULL_CRITICAL_PERCENT',
    1,
    errors,
  );
  const warnCpuPsiSomePercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_CPU_PSI_SOME_WARN_PERCENT',
    40,
    errors,
  );
  const criticalCpuPsiSomePercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_CPU_PSI_SOME_CRITICAL_PERCENT',
    70,
    errors,
  );
  const warnInodesPercent = parseThreshold(env, 'ESL_HOST_HEALTH_INODES_WARN_PERCENT', 10, errors);
  const criticalInodesPercent = parseThreshold(
    env,
    'ESL_HOST_HEALTH_INODES_CRITICAL_PERCENT',
    5,
    errors,
  );
  const restartWindowMinutes = parseThreshold(
    env,
    'ESL_HOST_HEALTH_RESTART_WINDOW_MINUTES',
    30,
    errors,
  );
  const alertCooldownMinutes = parseThreshold(
    env,
    'ESL_HOST_HEALTH_ALERT_COOLDOWN_MINUTES',
    60,
    errors,
  );
  const requestTimeoutMs = parseThreshold(env, 'ESL_HOST_HEALTH_HTTP_TIMEOUT_MS', 10_000, errors);

  if (criticalDiskMb >= warnDiskMb)
    errors.push('disk critical threshold must be below its warning threshold');
  if (criticalMemoryPercent >= warnMemoryPercent) {
    errors.push('memory critical threshold must be below its warning threshold');
  }
  if (criticalInodesPercent >= warnInodesPercent) {
    errors.push('inode critical threshold must be below its warning threshold');
  }
  if (criticalCpuPsiSomePercent <= warnCpuPsiSomePercent) {
    errors.push('CPU PSI critical threshold must be above its warning threshold');
  }

  const profiles = (env.COMPOSE_PROFILES ?? '').split(',').map((value) => value.trim());
  const expectedServices = [...REQUIRED_SERVICES];
  if (
    env.CADDY_PUBLIC_HOSTNAME?.trim() ||
    truthy(env.DEPLOY_INCLUDE_EDGE) ||
    profiles.includes('edge')
  ) {
    expectedServices.push('caddy-edge');
  }
  if (truthy(env.DEPLOY_INCLUDE_OPS_BOT) || profiles.includes('ops-bot')) {
    expectedServices.push('telegram-ops-bot');
  }

  return {
    errors,
    thresholds: {
      warnDiskMb,
      criticalDiskMb,
      warnMemoryPercent,
      criticalMemoryPercent,
      warnMemoryPsiSomePercent,
      criticalMemoryPsiFullPercent,
      warnCpuPsiSomePercent,
      criticalCpuPsiSomePercent,
      warnInodesPercent,
      criticalInodesPercent,
      restartWindowMinutes,
      alertCooldownMinutes,
      requestTimeoutMs,
    },
    expectedServices,
  };
}

function runDocker(args, dependencies = {}) {
  return (dependencies.execFileSync ?? execFileSync)('docker', args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: DOCKER_COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function collectDockerObservation(env, dependencies = {}) {
  const project = env.ESL_HOST_HEALTH_COMPOSE_PROJECT || 'esl-pipeline-prod';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(project)) {
    return { ok: false, error: 'Compose project name contains unsupported characters' };
  }
  try {
    const idsText = runDocker(
      ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
      dependencies,
    );
    const ids = idsText.trim().split(/\s+/u).filter(Boolean);
    const inspected =
      ids.length === 0 ? [] : JSON.parse(runDocker(['inspect', ...ids], dependencies));
    const containers = inspected.map((container) => ({
      id: container.Id,
      service: container.Config?.Labels?.['com.docker.compose.service'] ?? '',
      status: container.State?.Status ?? 'unknown',
      health: container.State?.Health?.Status ?? 'none',
      restartCount: Number.isInteger(container.RestartCount) ? container.RestartCount : 0,
    }));
    let dockerRoot = '/var/lib/docker';
    try {
      dockerRoot = runDocker(['info', '--format', '{{.DockerRootDir}}'], dependencies).trim();
    } catch {
      return { ok: false, error: 'Docker root directory could not be determined', containers };
    }
    return { ok: true, containers, dockerRoot };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Docker inventory command failed',
      containers: [],
    };
  }
}

export function collectMemoryObservation(env, dependencies = {}) {
  const readText = dependencies.readFileSync ?? readFileSync;
  const procRoot = env.ESL_HOST_HEALTH_PROC_ROOT || '/proc';
  try {
    const meminfo = readText(path.join(procRoot, 'meminfo'), 'utf8');
    const values = Object.fromEntries(
      [...meminfo.matchAll(/^(MemTotal|MemAvailable):\s+(\d+)\s+kB$/gmu)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    );
    if (!values.MemTotal || !Number.isFinite(values.MemAvailable)) {
      return { ok: false, error: 'MemTotal or MemAvailable is missing from /proc/meminfo' };
    }

    const parsePsiLine = (content, label) => {
      const line = content.split(/\r?\n/u).find((value) => value.startsWith(`${label} `));
      if (!line) return null;
      const match = line.match(
        /\bavg10=(\d+(?:\.\d+)?)\s+avg60=(\d+(?:\.\d+)?)\s+avg300=(\d+(?:\.\d+)?)/u,
      );
      return match
        ? { avg10: Number(match[1]), avg60: Number(match[2]), avg300: Number(match[3]) }
        : null;
    };
    let some = null;
    let full = null;
    let psiError = '';
    try {
      const psi = readText(path.join(procRoot, 'pressure', 'memory'), 'utf8');
      some = parsePsiLine(psi, 'some');
      full = parsePsiLine(psi, 'full');
    } catch (error) {
      psiError = error instanceof Error ? error.message : 'kernel memory PSI could not be read';
    }
    let cpuSome = null;
    try {
      const cpuPsi = readText(path.join(procRoot, 'pressure', 'cpu'), 'utf8');
      cpuSome = parsePsiLine(cpuPsi, 'some');
    } catch {
      // Older kernels may not expose CPU PSI; the health evaluator will report the missing signal.
    }
    return {
      ok: true,
      totalMb: Math.floor((values.MemTotal * 1024) / MEBIBYTE),
      availableMb: Math.floor((values.MemAvailable * 1024) / MEBIBYTE),
      availablePercent: (values.MemAvailable / values.MemTotal) * 100,
      psi: { some, full, cpuSome },
      psiError,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Host memory state could not be read',
    };
  }
}

function collectFilesystems(dockerRoot, env, dependencies) {
  const statfs = dependencies.statfsSync ?? statfsSync;
  const stat = dependencies.statSync ?? statSync;
  const hasPath = dependencies.existsSync ?? existsSync;
  const stateDir = env.ESL_HOST_HEALTH_STATE_DIR || '/var/lib/esl-pipeline/ops';
  const targets = [
    { label: 'application checkout', path: env.ESL_HOST_HEALTH_CHECKOUT || '/opt/esl-pipeline' },
    { label: 'Docker data', path: dockerRoot || '/var/lib/docker' },
    { label: 'operations state', path: stateDir },
  ];
  const groups = new Map();
  const errors = [];
  for (const target of targets) {
    try {
      const resolvedPath = path.resolve(target.path);
      if (!hasPath(resolvedPath)) throw new Error('configured path does not exist');
      const device = String(stat(resolvedPath).dev);
      let filesystem = groups.get(device);
      if (!filesystem) {
        const capacity = statfs(resolvedPath);
        filesystem = {
          availableMb: Math.floor((capacity.bavail * capacity.bsize) / MEBIBYTE),
          freeInodesPercent: capacity.files > 0 ? (capacity.ffree / capacity.files) * 100 : null,
          paths: [],
        };
        groups.set(device, filesystem);
      }
      filesystem.paths.push(target.label);
    } catch (error) {
      errors.push(
        `${target.label} filesystem could not be inspected at ${path.resolve(target.path)}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
  return { filesystems: [...groups.values()], errors };
}

function resolvePublicUrls(env) {
  const hostname = env.CADDY_PUBLIC_HOSTNAME?.trim();
  if (!hostname) return null;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    !hostname.includes('.') ||
    !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/u.test(hostname)
  )
    return { error: 'CADDY_PUBLIC_HOSTNAME is not a plain DNS hostname' };
  return {
    root: `https://${hostname}/`,
    apiHealth: `https://${hostname}/api/health`,
  };
}

export async function collectApplicationObservation(publicUrls, config, dependencies = {}) {
  if (!publicUrls)
    return { ok: false, error: 'CADDY_PUBLIC_HOSTNAME is not configured', checks: [] };
  if (publicUrls.error) return { ok: false, error: publicUrls.error, checks: [] };
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const checks = [];
  for (const [name, url] of Object.entries(publicUrls)) {
    try {
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(config.thresholds.requestTimeoutMs),
      });
      let healthOk = true;
      let error = '';
      if (name === 'apiHealth' && response.ok) {
        try {
          const body = await response.json();
          healthOk = body?.ok === true;
        } catch {
          healthOk = false;
        }
        if (!healthOk) error = 'health payload did not report ok: true';
      }
      checks.push({
        name,
        statusCode: response.status,
        ok: response.ok && healthOk,
        ...(error ? { error } : {}),
      });
    } catch {
      checks.push({ name, statusCode: null, ok: false });
    }
  }
  const failures = checks
    .filter((check) => !check.ok)
    .map((check) => {
      const status =
        check.statusCode === null ? 'request failed or timed out' : `HTTP ${check.statusCode}`;
      return `${check.name}: ${check.error ?? status}`;
    });
  return { ok: failures.length === 0, checks, errors: failures };
}

export async function collectHostObservation(env = process.env, dependencies = {}) {
  const config = hostHealthConfig(env);
  const docker = (dependencies.collectDocker ?? collectDockerObservation)(env, dependencies);
  const memory = (dependencies.collectMemory ?? collectMemoryObservation)(env, dependencies);
  const files = (dependencies.collectFilesystems ?? collectFilesystems)(
    docker.ok ? docker.dockerRoot : '/var/lib/docker',
    env,
    dependencies,
  );
  const application = await (dependencies.collectApplication ?? collectApplicationObservation)(
    resolvePublicUrls(env),
    config,
    dependencies,
  );
  const queues = await (dependencies.collectQueues ?? collectQueueObservation)(
    env,
    docker,
    dependencies.queueHistory ?? {},
    dependencies,
  );
  return {
    queues,
    checkedAtUtc: (dependencies.now?.() ?? new Date()).toISOString(),
    docker,
    memory,
    filesystems: files.filesystems,
    filesystemErrors: files.errors,
    application,
  };
}

function stateForIssues(issues) {
  if (issues.some((issue) => issue.severity === 'critical')) return 'critical';
  if (issues.length > 0) return 'degraded';
  return 'healthy';
}

function severityForState(state) {
  return state === 'critical' ? 2 : state === 'degraded' ? 1 : 0;
}

export function composeIssues(observation, config, previousState, nowEpoch) {
  const componentIssues = {};
  const allIssues = [];
  const addIssues = (name, issues, details = {}) => {
    componentIssues[name] = {
      state: stateForIssues(issues),
      reasons: issues.map((issue) => issue.message),
      ...details,
    };
    allIssues.push(...issues.map((issue) => ({ ...issue, component: name })));
  };

  const dockerIssues = [];
  const restartCounts = {};
  const restartEvents = [];
  if (!observation.docker.ok) {
    dockerIssues.push({
      severity: 'critical',
      message: `Docker state unavailable: ${observation.docker.error}`,
    });
  } else {
    const byService = new Map();
    for (const container of observation.docker.containers) {
      if (!container.service || !config.expectedServices.includes(container.service)) continue;
      const list = byService.get(container.service) ?? [];
      list.push(container);
      byService.set(container.service, list);
      const key = `${container.service}:${container.id}`;
      restartCounts[key] = container.restartCount;
      const oldCount = previousState.lastDockerRestartCounts?.[key];
      if (Number.isInteger(oldCount) && container.restartCount > oldCount) {
        restartEvents.push({
          service: container.service,
          delta: container.restartCount - oldCount,
          previousCount: oldCount,
          currentCount: container.restartCount,
        });
      }
    }
    for (const service of config.expectedServices) {
      const containers = byService.get(service) ?? [];
      if (containers.length === 0) {
        dockerIssues.push({
          severity: 'critical',
          message: `required Compose service ${service} has no container`,
        });
        continue;
      }
      for (const container of containers) {
        if (container.status !== 'running') {
          dockerIssues.push({
            severity: 'critical',
            message: `${service} container is ${container.status}`,
          });
        } else if (container.health === 'unhealthy') {
          dockerIssues.push({
            severity: 'critical',
            message: `${service} healthcheck is unhealthy`,
          });
        } else if (container.health === 'starting') {
          dockerIssues.push({
            severity: 'degraded',
            message: `${service} healthcheck is still starting`,
          });
        }
      }
    }
    for (const event of restartEvents) {
      dockerIssues.push({
        severity: 'degraded',
        message: `${event.service} restarted ${event.delta} time(s) since the previous successful observation`,
      });
    }
  }

  let lastRestartAtEpoch = Number.isInteger(previousState.lastRestartAtEpoch)
    ? previousState.lastRestartAtEpoch
    : 0;
  if (observation.docker.ok && restartEvents.length > 0) lastRestartAtEpoch = nowEpoch;
  const restartWindowSeconds = config.thresholds.restartWindowMinutes * 60;
  if (
    observation.docker.ok &&
    restartEvents.length === 0 &&
    lastRestartAtEpoch > 0 &&
    nowEpoch - lastRestartAtEpoch < restartWindowSeconds
  ) {
    dockerIssues.push({
      severity: 'degraded',
      message: 'a container restart was observed within the configured stability window',
    });
  }
  addIssues('containerRuntime', dockerIssues, {
    expectedServices: config.expectedServices,
    restartEvents,
  });

  const diskIssues = observation.filesystemErrors.map((message) => ({
    severity: 'degraded',
    message,
  }));
  for (const filesystem of observation.filesystems) {
    const paths = filesystem.paths.join(', ');
    if (filesystem.availableMb < config.thresholds.criticalDiskMb) {
      diskIssues.push({
        severity: 'critical',
        message: `${paths} has ${filesystem.availableMb} MiB available`,
      });
    } else if (filesystem.availableMb < config.thresholds.warnDiskMb) {
      diskIssues.push({
        severity: 'degraded',
        message: `${paths} has ${filesystem.availableMb} MiB available`,
      });
    }
    if (Number.isFinite(filesystem.freeInodesPercent)) {
      if (filesystem.freeInodesPercent < config.thresholds.criticalInodesPercent) {
        diskIssues.push({
          severity: 'critical',
          message: `${paths} has ${filesystem.freeInodesPercent.toFixed(1)}% free inodes`,
        });
      } else if (filesystem.freeInodesPercent < config.thresholds.warnInodesPercent) {
        diskIssues.push({
          severity: 'degraded',
          message: `${paths} has ${filesystem.freeInodesPercent.toFixed(1)}% free inodes`,
        });
      }
    }
  }
  addIssues('disk', diskIssues, { filesystems: observation.filesystems });

  const memoryIssues = [];
  if (!observation.memory.ok) {
    memoryIssues.push({
      severity: 'degraded',
      message: `host memory state unavailable: ${observation.memory.error}`,
    });
  } else {
    if (observation.memory.availablePercent <= config.thresholds.criticalMemoryPercent) {
      memoryIssues.push({
        severity: 'critical',
        message: `${observation.memory.availablePercent.toFixed(1)}% of host memory is available`,
      });
    } else if (observation.memory.availablePercent <= config.thresholds.warnMemoryPercent) {
      memoryIssues.push({
        severity: 'degraded',
        message: `${observation.memory.availablePercent.toFixed(1)}% of host memory is available`,
      });
    }
    const { some, full } = observation.memory.psi ?? {};
    if (!some) {
      memoryIssues.push({
        severity: 'degraded',
        message: 'kernel memory PSI some data is unavailable or malformed',
      });
    } else if (some.avg60 >= config.thresholds.warnMemoryPsiSomePercent) {
      memoryIssues.push({
        severity: 'degraded',
        message: `memory stalls averaged ${some.avg60.toFixed(1)}% over 60 seconds`,
      });
    }
    if (!full) {
      memoryIssues.push({
        severity: 'degraded',
        message: 'kernel memory PSI full data is unavailable or malformed',
      });
    } else {
      if (full.avg60 >= config.thresholds.criticalMemoryPsiFullPercent) {
        memoryIssues.push({
          severity: 'critical',
          message: `full memory stalls averaged ${full.avg60.toFixed(1)}% over 60 seconds`,
        });
      }
    }
  }
  addIssues('memory', memoryIssues, { memory: observation.memory });

  const cpuIssues = [];
  const cpuSomeAvg60 = observation.memory.ok ? observation.memory.psi?.cpuSome?.avg60 : null;
  if (!Number.isFinite(cpuSomeAvg60)) {
    cpuIssues.push({ severity: 'degraded', message: 'kernel CPU PSI is unavailable or malformed' });
  } else if (cpuSomeAvg60 >= config.thresholds.criticalCpuPsiSomePercent) {
    cpuIssues.push({
      severity: 'critical',
      message: `CPU scheduling stalls averaged ${cpuSomeAvg60.toFixed(1)}% over 60 seconds`,
    });
  } else if (cpuSomeAvg60 >= config.thresholds.warnCpuPsiSomePercent) {
    cpuIssues.push({
      severity: 'degraded',
      message: `CPU scheduling stalls averaged ${cpuSomeAvg60.toFixed(1)}% over 60 seconds`,
    });
  }
  addIssues('cpuPressure', cpuIssues, {
    psiSomeAvg60Percent: Number.isFinite(cpuSomeAvg60) ? cpuSomeAvg60 : null,
  });

  const appIssues = observation.application.ok
    ? []
    : (
        observation.application.errors ?? [
          observation.application.error ?? 'public application check failed',
        ]
      ).map((message) => ({ severity: 'critical', message }));
  addIssues('applicationReachability', appIssues, { checks: observation.application.checks ?? [] });

  const queueResult = evaluateQueueObservation(
    observation.queues,
    previousState.queueHistory,
    nowEpoch * 1000,
  );
  addIssues('workerQueues', queueResult.issues, {
    queues: queueResult.queues,
    observationState: observation.queues?.ok ? 'available' : 'observation_unavailable',
  });

  for (const message of config.errors) {
    const issue = {
      severity: 'degraded',
      message: `monitor configuration: ${message}`,
      component: 'configuration',
    };
    allIssues.push(issue);
  }
  if (config.errors.length > 0) {
    componentIssues.configuration = {
      state: 'degraded',
      reasons: config.errors,
    };
  } else {
    componentIssues.configuration = { state: 'healthy', reasons: [] };
  }

  const overallState = stateForIssues(allIssues);
  return {
    status: {
      checkedAtUtc: observation.checkedAtUtc,
      overall: {
        state: overallState,
        reasons: allIssues.map((issue) => `${issue.component}: ${issue.message}`),
      },
      components: componentIssues,
      thresholds: config.thresholds,
    },
    restartCounts: observation.docker.ok
      ? restartCounts
      : (previousState.lastDockerRestartCounts ?? {}),
    lastRestartAtEpoch,
    queueHistory: queueResult.history,
  };
}

function readState(file, dependencies) {
  try {
    const content = (dependencies.readFileSync ?? readFileSync)(file, 'utf8');
    const state = JSON.parse(content);
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

function normalizeAlertState(value) {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const lastState = ['healthy', 'degraded', 'critical'].includes(state.lastState)
    ? state.lastState
    : '';
  const lastSentEpoch =
    lastState && typeof state.lastSentEpoch === 'number' && Number.isFinite(state.lastSentEpoch)
      ? Math.max(0, state.lastSentEpoch)
      : 0;
  const lastDockerRestartCounts =
    state.lastDockerRestartCounts &&
    typeof state.lastDockerRestartCounts === 'object' &&
    !Array.isArray(state.lastDockerRestartCounts)
      ? Object.fromEntries(
          Object.entries(state.lastDockerRestartCounts).filter(
            ([, count]) => Number.isInteger(count) && count >= 0,
          ),
        )
      : {};

  return {
    queueHistory: normalizeQueueHistory(state.queueHistory),
    lastState,
    lastSeverity: severityForState(lastState),
    lastSentEpoch,
    lastDockerRestartCounts,
    lastRestartAtEpoch:
      Number.isSafeInteger(state.lastRestartAtEpoch) && state.lastRestartAtEpoch >= 0
        ? state.lastRestartAtEpoch
        : 0,
  };
}

function writeState(file, state, dependencies) {
  const mkdir = dependencies.mkdirSync ?? mkdirSync;
  const write = dependencies.writeFileSync ?? writeFileSync;
  const rename = dependencies.renameSync ?? renameSync;
  mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  const tempFile = `${file}.${process.pid}.tmp`;
  write(tempFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
  rename(tempFile, file);
}

function alertKindFor(currentState, previousState, nowEpoch, cooldownSeconds) {
  if (currentState === 'healthy') {
    return previousState.lastState && previousState.lastState !== 'healthy' ? 'recovery' : '';
  }
  if (!previousState.lastState || previousState.lastState === 'healthy') return 'failure';
  if (severityForState(currentState) > (previousState.lastSeverity ?? 0)) return 'escalation';
  if (nowEpoch - (previousState.lastSentEpoch ?? 0) >= cooldownSeconds) return 'cooldown-repeat';
  return '';
}

function formatAlert(status, alertKind) {
  if (status.overall.state === 'healthy') {
    return `ESL host/runtime health recovered to healthy.\n\nChecked at: ${status.checkedAtUtc}`;
  }
  return [
    `ESL host/runtime alert: ${status.overall.state} (${alertKind})`,
    '',
    `Checked at: ${status.checkedAtUtc}`,
    ...status.overall.reasons.map((reason) => `- ${reason}`),
  ].join('\n');
}

async function sendTelegram(message, env, dependencies) {
  if (env.PG_BACKUP_ALERT_TELEGRAM_DISABLE === 'true')
    return { configured: false, result: 'disabled' };
  const token = env.PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN ?? '';
  const chatId = env.PG_BACKUP_ALERT_TELEGRAM_CHAT_ID ?? '';
  if (!token || !chatId) return { configured: false, result: 'missing-config' };
  try {
    const body = new URLSearchParams({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: 'true',
    });
    if (env.PG_BACKUP_ALERT_TELEGRAM_THREAD_ID) {
      body.set('message_thread_id', env.PG_BACKUP_ALERT_TELEGRAM_THREAD_ID);
    }
    const response = await (dependencies.fetch ?? globalThis.fetch)(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      return {
        configured: true,
        result: 'failed',
        error: `Telegram returned HTTP ${response.status}`,
      };
    const result = await response.json().catch(() => null);
    return result?.ok === true
      ? { configured: true, result: 'sent' }
      : { configured: true, result: 'failed', error: 'Telegram rejected the message' };
  } catch {
    return { configured: true, result: 'failed', error: 'Telegram request failed or timed out' };
  }
}

export async function runHostRuntimeHealthAlert(options = {}) {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now?.() ?? new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const config = hostHealthConfig(env);
  const stateFile = env.ESL_HOST_HEALTH_ALERT_STATE_FILE || DEFAULT_STATE_FILE;
  const previous = normalizeAlertState(options.previousState ?? readState(stateFile, dependencies));
  const observation = await (dependencies.collectObservation ?? collectHostObservation)(env, {
    ...dependencies,
    now: () => now,
    queueHistory: previous.queueHistory,
  });
  const evaluated = composeIssues(observation, config, previous, nowEpoch);
  const currentState = evaluated.status.overall.state;
  const kind = alertKindFor(
    currentState,
    previous,
    nowEpoch,
    config.thresholds.alertCooldownMinutes * 60,
  );
  let delivery = { configured: true, result: 'not-needed' };
  if (kind)
    delivery = await (dependencies.sendTelegram ?? sendTelegram)(
      formatAlert(evaluated.status, kind),
      env,
      dependencies,
    );

  const wasDelivered = !kind || delivery.result === 'sent';
  const nextState = {
    ...(wasDelivered
      ? {
          lastState: currentState,
          lastSeverity: severityForState(currentState),
        }
      : {
          lastState: previous.lastState ?? '',
          lastSeverity: previous.lastSeverity ?? 0,
        }),
    lastSentEpoch: delivery.result === 'sent' ? nowEpoch : (previous.lastSentEpoch ?? 0),
    queueHistory: evaluated.queueHistory,
    lastCheckedAtUtc: evaluated.status.checkedAtUtc,
    lastDockerRestartCounts: evaluated.restartCounts,
    lastRestartAtEpoch: evaluated.lastRestartAtEpoch,
  };
  (dependencies.writeState ?? writeState)(stateFile, nextState, dependencies);

  return {
    ...evaluated.status,
    alert: {
      kind: kind || null,
      delivery: delivery.result,
      pending: Boolean(kind) && delivery.result !== 'sent',
      ...(delivery.error ? { error: delivery.error } : {}),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runHostRuntimeHealthAlert();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.overall.state === 'healthy' ? 0 : 1;
  } catch (error) {
    console.error(
      `ERROR: host/runtime health check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
