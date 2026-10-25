import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Disposable ingress proof only. No Google account, credentials, provider traffic or event writes.
// Backend semantics are independently checked by transport.google-calendar-connection.postgres.test.ts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmpRoot = path.join(root, 'tmp');
await mkdir(tmpRoot, { recursive: true });
const dir = await mkdtemp(path.join(tmpRoot, 'calendar-ingress-'));
const id = `calendar-ingress-${process.pid}-${Date.now()}`;
const network = `${id}-network`;
const containers = [];
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const dockerLogs = (name) => {
  const result = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to read disposable ingress logs');
  return (result.stdout ?? '') + (result.stderr ?? '');
};
const sentinel = `calendar-secret-sentinel-${Date.now()}`;
const backend = `${id}-backend`,
  frontend = `${id}-nginx`,
  edge = `${id}-caddy`,
  probe = `${id}-probe`;
let networkCreated = false;
try {
  await writeFile(
    path.join(dir, 'backend.mjs'),
    `import http from 'node:http';
http.createServer((req,res)=>{
  const pathname=req.url.split('?')[0];
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(pathname==='/google/calendar/callback'){res.writeHead(303,{Location:'/calendar/connection-result'});res.end();}
  else{res.writeHead(pathname.endsWith('/error')?500:404);res.end('sanitized');}
  console.log(JSON.stringify({route:'google_calendar_callback',method:req.method,status:res.statusCode}));
}).listen(8080,'0.0.0.0');`,
  );
  // Disable automatic HTTPS only in this local harness. All ingress/logging directives are current source.
  const caddy = (await readFile(path.join(root, 'deploy/caddy/Caddyfile'), 'utf8')).replace(
    '{\n',
    '{\n\tauto_https off\n',
  );
  await writeFile(path.join(dir, 'Caddyfile'), caddy);
  // Shorten only network timeouts in the disposable test so upstream failures are bounded.
  const nginx = (await readFile(path.join(root, 'packages/batch-frontend/nginx.conf'), 'utf8'))
    .replaceAll('proxy_http_version 1.1;', 'proxy_http_version 1.1;\n    proxy_connect_timeout 1s;')
    .replaceAll('proxy_read_timeout 300s;', 'proxy_read_timeout 1s;');
  await writeFile(path.join(dir, 'nginx.conf'), nginx);
  docker('network', 'create', '--internal', network);
  networkCreated = true;
  function start(name, image, alias, mounts, env = [], ports = [], command = []) {
    docker(
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '--network-alias',
      alias,
      ...mounts.flatMap(([src, dst]) => [
        '--mount',
        `type=bind,source=${src},target=${dst},readonly`,
      ]),
      ...env.flatMap((value) => ['-e', value]),
      ...ports.flatMap((port) => ['-p', `127.0.0.1::${port}`]),
      image,
      ...command,
    );
    containers.push(name);
  }
  start(
    backend,
    'esl-pipeline/dev-node-base:local',
    'batch-backend',
    [[path.join(dir, 'backend.mjs'), '/tmp/backend.mjs']],
    [],
    [],
    ['node', '/tmp/backend.mjs'],
  );
  start(
    frontend,
    'nginx:1.31-alpine3.23-slim',
    'batch-frontend',
    [
      [path.join(root, 'packages/batch-frontend/nginx-rootless.conf'), '/etc/nginx/nginx.conf'],
      [path.join(dir, 'nginx.conf'), '/etc/nginx/conf.d/default.conf'],
    ],
    [],
    ['8080'],
    ['sh', '-c', 'mkdir -p /tmp/nginx && exec nginx -g "daemon off;"'],
  );
  start(
    edge,
    'caddy:2.11-alpine',
    'caddy-edge',
    [[path.join(dir, 'Caddyfile'), '/etc/caddy/Caddyfile']],
    [
      'CADDY_PUBLIC_HOSTNAME=http://calendar.test:8081',
      'CADDY_ACME_EMAIL=synthetic@example.test',
      'CADDY_TRANSITION_MODE=disabled',
    ],
    ['8081'],
  );
  start(
    probe,
    'esl-pipeline/dev-node-base:local',
    'probe',
    [],
    [],
    [],
    ['node', '-e', 'setInterval(()=>{},1000)'],
  );
  const base = (name) => (name === edge ? 'http://caddy-edge:8081' : 'http://batch-frontend:8080');
  async function request(url) {
    const headers = {
      Host: 'calendar.test',
      Cookie: `synthetic=${sentinel}`,
      Authorization: `Bearer ${sentinel}`,
      Referer: `https://example.test/${sentinel}`,
      'User-Agent': sentinel,
    };
    const result = JSON.parse(
      docker(
        'exec',
        probe,
        'node',
        '-e',
        `const http=require('node:http');const req=http.request(${JSON.stringify(url)},{headers:${JSON.stringify(headers)}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>console.log(JSON.stringify({status:res.statusCode,headers:Object.entries(res.headers),body})));});req.on('error',()=>process.exit(1));req.setTimeout(10000,()=>req.destroy());req.end();`,
      ),
    );
    return { status: result.status, headers: result.headers, text: async () => result.body };
  }
  async function ready(name) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await request(`${base(name)}/api/google/calendar/callback`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const state = docker('inspect', '--format', '{{json .State}}', name);
    const diagnostic = dockerLogs(name).replaceAll(sentinel, '[REDACTED]');
    throw new Error(`Disposable ingress ${name} failed to become ready: ${state}; ${diagnostic}`);
  }
  await ready(frontend);
  await ready(edge);
  let assertions = 0;
  for (const name of [frontend, edge]) {
    for (const [pathname, status] of [
      ['/api/google/calendar/callback', 303],
      ['/api/google/calendar/callback/error', 500],
      ['/api/google/calendar/callback/unmatched', 404],
      ['/api/google/calendar/%63allback/unmatched', 404],
      ['/api/google/calendar/callback%ZZ', 400],
    ]) {
      const response = await request(
        `${base(name)}${pathname}?code=${sentinel}&state=${sentinel}&error_description=${sentinel}`,
      );
      assert.equal(response.status, status, `${name}: ${pathname}`);
      assert.ok(
        !JSON.stringify([...response.headers]).includes(sentinel),
        'Sentinel leaked in redirect/header',
      );
      assert.ok(!(await response.text()).includes(sentinel), 'Sentinel leaked in body');
      assertions++;
    }
  }
  docker('stop', '-t', '1', backend);
  for (const name of [frontend, edge]) {
    const response = await request(
      `${base(name)}/api/google/calendar/callback?code=${sentinel}&state=${sentinel}`,
    );
    assert.ok([502, 504].includes(response.status));
    assert.ok(!JSON.stringify([...response.headers]).includes(sentinel));
    assertions++;
  }
  docker('stop', '-t', '1', frontend);
  const response = await request(
    `${base(edge)}/api/google/calendar/callback?code=${sentinel}&state=${sentinel}`,
  );
  assert.ok([502, 504].includes(response.status));
  assertions++;
  const logsByName = new Map(containers.map((name) => [name, dockerLogs(name)]));
  for (const [name, logs] of logsByName)
    assert.ok(!logs.includes(sentinel), `Sentinel leaked in ${name} logs`);
  const nginxLogs = logsByName.get(frontend) ?? '';
  assert.match(nginxLogs, /"route":"google_calendar_callback"/);
  assert.match(nginxLogs, /"status":50[24]/);
  assert.match(nginxLogs, /"status":400/);
  assert.match(nginxLogs, /"requestId":"[a-f0-9]+"/);
  process.stdout.write(
    `Calendar ingress sentinel proof passed: ${assertions} HTTP outcomes across nginx/Caddy; backend/nginx/Caddy logs and redirects contain no sentinels.\n`,
  );
} finally {
  for (const name of [...containers].reverse()) {
    try {
      docker('rm', '-f', name);
    } catch {
      /* preserve original failure */
    }
  }
  if (networkCreated) {
    try {
      docker('network', 'rm', network);
    } catch {
      /* preserve original failure */
    }
  }
  const resolved = path.resolve(dir);
  if (resolved.startsWith(path.resolve(tmpRoot) + path.sep))
    await rm(resolved, { recursive: true, force: true });
}
