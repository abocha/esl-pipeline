import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

function requireFile(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
    throw new Error(`Required regular nonempty artifact: ${file}`);
  return readFileSync(file);
}

export function verifyManifest(directory, file, allowed) {
  const rows = requireFile(path.join(directory, file)).toString().trim().split('\n');
  const seen = new Set();
  for (const row of rows) {
    const match = row.match(/^([a-f0-9]{64}) [ *](.+)$/u);
    if (!match) throw new Error('Malformed checksum manifest');
    const name = path.basename(match[2]);
    if (!allowed.includes(name) || seen.has(name)) throw new Error('Unexpected checksum artifact');
    if (match[2] !== name && match[2] !== `/bundle/postgres/${name}`)
      throw new Error('Checksum path outside bundle');
    const actual = createHash('sha256')
      .update(requireFile(path.join(directory, name)))
      .digest('hex');
    if (actual !== match[1]) throw new Error(`Checksum mismatch: ${name}`);
    seen.add(name);
  }
  if (seen.size !== allowed.length) throw new Error('Missing checksum artifact');
}

export function recoveryPreflight(bundle, revision, envFile = '/opt/esl-pipeline/.env') {
  if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('Full pinned application SHA required');
  if (requireFile(path.join(bundle, 'application-revision')).toString().trim() !== revision)
    throw new Error('Backup application revision mismatch');
  const env = parseEnv(requireFile(envFile).toString());
  const required = {
    PG_HOST: 'postgres',
    PG_DATABASE: 'esl_batch',
    PG_AUTO_MIGRATE_ON_BOOT: 'false',
    REDIS_HOST: 'redis',
    S3_ENDPOINT: 'http://rehearsal-s3:5000',
    AWS_ENDPOINT_URL_S3: 'http://127.0.0.1:15001',
    AWS_ACCESS_KEY_ID: 'synthetic-rehearsal',
    AWS_SECRET_ACCESS_KEY: 'synthetic-rehearsal',
    PG_BACKUP_ALERT_TELEGRAM_DISABLE: 'true',
  };
  for (const [key, value] of Object.entries(required))
    if (env[key] !== value) throw new Error(`Missing/unsafe rehearsal operator input: ${key}`);
  if (!env.JWT_SECRET) throw new Error('Missing JWT signing input');
  verifyManifest(bundle, 'state.sha256', [
    'uploads.tar',
    'redis.tar',
    'product.json',
    'media.json',
  ]);
  const directory = path.join(bundle, 'postgres');
  const dumps = readdirSync(directory).filter((name) => name.endsWith('.dump'));
  if (dumps.length !== 1) throw new Error('Exactly one DB dump required');
  const prefix = dumps[0].slice(0, -5);
  verifyManifest(directory, `${prefix}.sha256`, [
    dumps[0],
    `${prefix}.sql.gz`,
    `${prefix}_schema.sql`,
  ]);
  if (requireFile(path.join(directory, dumps[0])).subarray(0, 5).toString() !== 'PGDMP')
    throw new Error('Unreadable custom database dump');
  return { ok: true, revision, artifactsVerified: 7 };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(recoveryPreflight(...process.argv.slice(2))));
}
