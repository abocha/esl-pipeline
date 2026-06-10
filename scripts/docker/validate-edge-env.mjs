import { fileURLToPath } from 'node:url';

const LOCAL_EDGE_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function validateEdgeEnv(env = process.env) {
  const hostname = readRequiredEnv(env, 'CADDY_PUBLIC_HOSTNAME');
  const email = readRequiredEnv(env, 'CADDY_ACME_EMAIL');

  if (!isPlainPublicDnsHostname(hostname)) {
    throw new Error('CADDY_PUBLIC_HOSTNAME must be a plain public DNS hostname.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('CADDY_ACME_EMAIL must be a valid email address.');
  }

  return { hostname, email };
}

function isPlainPublicDnsHostname(value) {
  if (value.length > 253 || LOCAL_EDGE_HOSTNAMES.has(value.toLowerCase())) {
    return false;
  }

  const labels = value.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > 63)) {
    return false;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) {
    return false;
  }

  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function readRequiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Caddy edge profile.`);
  }
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    validateEdgeEnv();
    console.log('Caddy edge environment is valid.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
