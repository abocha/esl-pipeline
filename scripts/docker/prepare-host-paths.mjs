#!/usr/bin/env node
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requiredDirs = ['uploads', path.join('uploads', 'drafts')];
const defaultElevenLabsVoicesPath = path.join(
  'packages',
  'orchestrator',
  'configs',
  'elevenlabs.voices.json',
);
const envFiles = ['.env.batch-backend', '.env'];
const productionRuntimeUid = 1000;
const productionRuntimeGid = 1000;

const emptyVoiceCapabilities = {
  generatedAt: new Date().toISOString(),
  role: ['narrator', 'teacher', 'student', 'system'],
  gender: ['child', 'female', 'male', 'neutral'],
  age: ['adult', 'child', 'middle_aged', 'senior', 'teen', 'universal', 'young'],
  accent: [],
  style: [],
};

function permissionFixHint(target) {
  if (process.platform === 'win32') {
    return `Check folder permissions for ${target}.`;
  }

  return `Fix with:\n  sudo chown -R "$(id -un):$(id -gn)" "${target}"`;
}

async function loadLocalEnvFiles() {
  for (const rel of envFiles) {
    try {
      const parsed = parseEnv(await fs.readFile(path.join(rootDir, rel), 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
}

function displayPath(abs) {
  const relative = path.relative(rootDir, abs);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replaceAll(path.sep, '/')
    : abs;
}

async function assertWritableDirectory(abs, rel) {
  await fs.mkdir(abs, { recursive: true });

  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    throw new Error(`expected directory was not created: ${rel}`);
  }

  try {
    await fs.access(abs, constants.W_OK);
  } catch {
    throw new Error(`directory is not writable: ${rel}\n${permissionFixHint(abs)}`);
  }

  const probe = path.join(abs, `.write-test-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(probe, '');
  } catch {
    throw new Error(`directory is not writable: ${rel}\n${permissionFixHint(abs)}`);
  } finally {
    await fs.rm(probe, { force: true });
  }

  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    const expectedOwner = `${process.getuid()}:${process.getgid()}`;
    const actualOwner = `${stat.uid}:${stat.gid}`;
    if (actualOwner !== expectedOwner) {
      console.warn(`WARN: ${rel} is owned by ${actualOwner} (expected ${expectedOwner})`);
    }
    const expectedRuntimeOwner = `${productionRuntimeUid}:${productionRuntimeGid}`;
    if (actualOwner !== expectedRuntimeOwner) {
      console.warn(
        `WARN: production containers run as ${expectedRuntimeOwner}; ensure ${rel} stays writable by that UID:GID on the VPS.`,
      );
    }
  }
}

async function ensureElevenLabsVoicesCatalog() {
  const configuredPath =
    process.env.ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH?.trim() || defaultElevenLabsVoicesPath;
  const abs = path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(rootDir, configuredPath);
  const rel = displayPath(abs);

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error(`expected file path is not a file: ${rel}`);
    }
    return;
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(abs), { recursive: true });
  const catalog = {
    generatedAt: emptyVoiceCapabilities.generatedAt,
    capabilities: emptyVoiceCapabilities,
    voices: [],
  };
  await fs.writeFile(abs, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Created empty ElevenLabs voices catalog at ${rel}.`);
}

console.log('Preparing Docker host paths...');

try {
  await loadLocalEnvFiles();

  for (const rel of requiredDirs) {
    await assertWritableDirectory(path.join(rootDir, rel), rel.replaceAll(path.sep, '/'));
  }
  await ensureElevenLabsVoicesCatalog();

  console.log('Docker host paths are ready.');
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
