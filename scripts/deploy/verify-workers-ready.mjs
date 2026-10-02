#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const WORKERS = [
  { service: 'batch-worker', env: 'BATCH_JOBS_QUEUE_NAME', queue: 'esl-jobs' },
  { service: 'transcribe-worker', env: 'TRANSCRIBE_QUEUE_NAME', queue: 'transcribe-queue' },
  {
    service: 'student-memory-worker',
    env: 'STUDENT_MEMORY_QUEUE_NAME',
    queue: 'student-memory-queue',
  },
];

export function matchesReadiness(record, container, worker) {
  const queue =
    (container.Config.Env ?? [])
      .find((value) => value.startsWith(`${worker.env}=`))
      ?.slice(worker.env.length + 1) || worker.queue;
  const timestamp = Date.parse(record?.timestamp);
  return (
    container.State.Running === true &&
    !container.State.Paused &&
    record?.event === 'worker_ready' &&
    record.service === worker.service &&
    record.queue === queue &&
    record.instance?.hostname === container.Config.Hostname &&
    Number.isInteger(record.instance?.pid) &&
    record.instance.pid > 0 &&
    typeof record.instance?.startupId === 'string' &&
    record.instance.startupId.length > 0 &&
    Number.isFinite(timestamp) &&
    timestamp >= Date.parse(container.State.StartedAt) &&
    timestamp <= Date.now()
  );
}

export async function verifyWorkersReady(ids, { docker, timeoutMs = 60_000, retryMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  docker ??= async (args) =>
    (
      await promisify(execFile)('docker', args, {
        encoding: 'utf8',
        timeout: Math.max(1, Math.min(10_000, deadline - Date.now())),
        maxBuffer: 10 * 1024 * 1024,
      })
    ).stdout;
  let missing = WORKERS.map(({ service }) => service);
  do {
    const containers = JSON.parse(await docker(['inspect', ...ids]));
    const ready = [];
    for (const worker of WORKERS) {
      const instances = containers.filter(
        (container) => container.Config.Labels?.['com.docker.compose.service'] === worker.service,
      );
      if (instances.length !== 1) continue;
      const container = instances[0];
      if (!container.State.Running || container.State.Paused) continue;
      const logs = await docker(['logs', '--since', container.State.StartedAt, container.Id]);
      const records = logs.split('\n').flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      if (records.some((record) => matchesReadiness(record, container, worker)))
        ready.push(container);
    }
    // A restart/recreation during log collection invalidates that instance's evidence.
    const current = JSON.parse(await docker(['inspect', ...ids]));
    missing = WORKERS.filter(
      ({ service }) =>
        !ready.some(
          (container) =>
            container.Config.Labels['com.docker.compose.service'] === service &&
            current.some(
              (value) =>
                value.Id === container.Id &&
                value.State.Running &&
                !value.State.Paused &&
                value.State.StartedAt === container.State.StartedAt,
            ),
        ),
    ).map(({ service }) => service);
    if (!missing.length)
      return { event: 'deployment_workers_ready', services: WORKERS.map((x) => x.service) };
    if (Date.now() + retryMs >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  } while (Date.now() < deadline);
  throw new Error(`Current-instance worker_ready evidence missing: ${missing.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5)
      throw new Error('Expected exactly three current worker container IDs');
    console.log(JSON.stringify(await verifyWorkersReady(process.argv.slice(2))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
