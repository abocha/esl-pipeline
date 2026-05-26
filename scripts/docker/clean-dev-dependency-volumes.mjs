#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const defaultProjectName = 'esl-pipeline';

const dependencyVolumeKeys = [
  'workspace_node_modules',
  'workspace_pnpm_store',
  'pkg_batch_backend_node_modules',
  'pkg_batch_frontend_node_modules',
  'pkg_contracts_node_modules',
  'pkg_html_publisher_node_modules',
  'pkg_md_validator_node_modules',
  'pkg_orchestrator_node_modules',
  'pkg_pmd_node_modules',
  'pkg_provider_runtime_node_modules',
  'pkg_shared_infrastructure_node_modules',
  'pkg_storage_uploader_node_modules',
  'pkg_stt_core_node_modules',
  'pkg_stt_provider_deepgram_node_modules',
  'pkg_stt_provider_elevenlabs_node_modules',
  'pkg_stt_provider_google_node_modules',
  'pkg_telegram_ops_bot_node_modules',
  'pkg_tts_core_node_modules',
  'pkg_tts_provider_elevenlabs_node_modules',
  'pkg_tts_provider_google_node_modules',
  'pkg_tts_provider_inworld_node_modules',
  'example_orchestrator_service_node_modules',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectNameArgIndex = args.indexOf('--project-name');
const projectName =
  projectNameArgIndex >= 0 && args[projectNameArgIndex + 1]
    ? args[projectNameArgIndex + 1]
    : process.env.COMPOSE_PROJECT_NAME || defaultProjectName;

if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(projectName)) {
  console.error(
    `Refusing to remove Docker volumes for invalid Compose project name: ${projectName}`,
  );
  process.exit(1);
}

const expectedVolumes = new Set(
  dependencyVolumeKeys.map((volumeKey) => `${projectName}_${volumeKey}`),
);

const volumeList = spawnSync('docker', ['volume', 'ls', '--format', '{{.Name}}'], {
  encoding: 'utf8',
});

if (volumeList.status !== 0) {
  console.error('Unable to list Docker volumes. Is Docker running?');
  if (volumeList.stderr) {
    console.error(volumeList.stderr.trim());
  }
  process.exit(volumeList.status || 1);
}

const existingVolumes = volumeList.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => expectedVolumes.has(line));

if (existingVolumes.length === 0) {
  console.log(`No dev dependency volumes found for Compose project "${projectName}".`);
  process.exit(0);
}

const action = dryRun ? 'Would remove' : 'Removing';
console.log(`${action} ${existingVolumes.length} dev dependency volume(s):`);
for (const volumeName of existingVolumes) {
  console.log(`- ${volumeName}`);
}

if (dryRun) {
  process.exit(0);
}

const remove = spawnSync('docker', ['volume', 'rm', ...existingVolumes], {
  stdio: 'inherit',
});

if (remove.status !== 0) {
  console.error(
    'Failed to remove one or more dependency volumes. Run pnpm docker:dev:down first, then retry.',
  );
  process.exit(remove.status || 1);
}
