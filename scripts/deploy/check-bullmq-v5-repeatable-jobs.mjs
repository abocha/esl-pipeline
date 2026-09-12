import { Queue } from 'bullmq';

const getRepeatableJobs = Queue.prototype.getRepeatableJobs;
if (typeof getRepeatableJobs !== 'function') {
  throw new Error(
    'This read-only preflight must run inside the currently deployed BullMQ v5 backend container before BullMQ v6 is deployed.',
  );
}

const redisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
if (!Number.isSafeInteger(redisPort) || redisPort <= 0 || redisPort > 65_535) {
  throw new Error('REDIS_PORT must be a valid TCP port.');
}

const connection = {
  host: process.env.REDIS_HOST || 'redis',
  port: redisPort,
  maxRetriesPerRequest: null,
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
};
const queueNames = [
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this host-run preflight inherits the deployed container environment outside Turbo.
  process.env.BATCH_JOBS_QUEUE_NAME || 'esl-jobs',
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this host-run preflight inherits the deployed container environment outside Turbo.
  process.env.TRANSCRIBE_QUEUE_NAME || 'transcribe-queue',
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this host-run preflight inherits the deployed container environment outside Turbo.
  process.env.STUDENT_MEMORY_QUEUE_NAME || 'student-memory-queue',
].filter((queueName, index, names) => names.indexOf(queueName) === index);

const results = [];
for (const queueName of queueNames) {
  const queue = new Queue(queueName, { connection });
  try {
    const repeatableJobs = await getRepeatableJobs.call(queue);
    results.push({ queueName, count: repeatableJobs.length });
  } finally {
    await queue.close();
  }
}

for (const result of results) {
  console.log(`${result.queueName}: ${result.count} legacy repeatable definition(s)`);
}

const legacyCount = results.reduce((count, result) => count + result.count, 0);
if (legacyCount > 0) {
  throw new Error(
    'Legacy BullMQ repeatable metadata exists. Stop the v6 deployment and obtain separate approval to inspect and migrate or remove those definitions while production still runs BullMQ v5.',
  );
}

console.log('BullMQ v6 preflight passed: no legacy repeatable definitions were found.');
