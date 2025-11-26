import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigurationError } from '@esl-pipeline/contracts';
import { resolveManifestStoreConfig } from '@esl-pipeline/shared-infrastructure';

import {
  RemoteConfigProvider,
  type RemoteConfigProviderOptions,
} from './adapters/config/remote.js';
import { S3ManifestStore, type S3ManifestStoreOptions } from './adapters/manifest/s3.js';
import { createFilesystemConfigProvider } from './config.js';
import type { ConfigProvider } from './config.js';
import type { AssignmentProgressCallbacks, NewAssignmentFlags, RerunFlags } from './index.js';
import { createFilesystemManifestStore, manifestPathFor } from './manifest.js';
import type { ManifestStore } from './manifest.js';
import {
  type PipelineLogger,
  type PipelineMetrics,
  noopLogger,
  noopMetrics,
} from './observability.js';

// Re-export loadEnvFiles for backward compatibility

type OrchestratorModule = typeof import('./index.js');

const orchestratorModuleLoader = (() => {
  let cache: Promise<OrchestratorModule> | null = null;
  return () => {
    if (!cache) {
      cache = import('./index.js');
    }
    return cache;
  };
})();

export interface ResolveConfigPathsOptions {
  cwd?: string;
  configDir?: string;
  presetsPath?: string;
  voicesPath?: string;
  studentsDir?: string;
}

export interface ResolvedConfigPaths {
  configRoot: string;
  presetsPath: string;
  voicesPath: string;
  studentsDir: string;
  wizardDefaultsPath: string;
}

export function resolveConfigPaths(options: ResolveConfigPathsOptions = {}): ResolvedConfigPaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const distConfigs = resolve(moduleDir, './configs');
  const repoConfigs = resolve(moduleDir, '../../../configs');
  const candidateConfigDirs = [
    options.configDir,
    process.env.ESL_PIPELINE_CONFIG_DIR,
    join(cwd, 'configs'),
    distConfigs,
    repoConfigs,
  ]
    .filter(Boolean)
    .map((dir) => resolve(String(dir)));

  const presetsPath =
    options.presetsPath && existsSync(resolvePath(options.presetsPath, cwd))
      ? resolvePath(options.presetsPath, cwd)
      : findFirstExistingPath(candidateConfigDirs.map((dir) => join(dir, 'presets.json')));

  if (!presetsPath) {
    throw new ConfigurationError(
      `Unable to locate presets.json. Checked: ${candidateConfigDirs
        .map((dir) => join(dir, 'presets.json'))
        .join(', ')}`,
    );
  }

  const voicesPath =
    options.voicesPath && existsSync(resolvePath(options.voicesPath, cwd))
      ? resolvePath(options.voicesPath, cwd)
      : findFirstExistingPath(candidateConfigDirs.map((dir) => join(dir, 'voices.yml')));

  if (!voicesPath) {
    throw new ConfigurationError(
      `Unable to locate voices.yml. Checked: ${candidateConfigDirs
        .map((dir) => join(dir, 'voices.yml'))
        .join(', ')}`,
    );
  }

  const studentsDir =
    options.studentsDir && existsSync(resolvePath(options.studentsDir, cwd))
      ? resolvePath(options.studentsDir, cwd)
      : findFirstExistingPath(candidateConfigDirs.map((dir) => join(dir, 'students')));

  if (!studentsDir) {
    throw new ConfigurationError(
      `Unable to locate students directory. Checked: ${candidateConfigDirs
        .map((dir) => join(dir, 'students'))
        .join(', ')}`,
    );
  }

  const configRoot = dirname(presetsPath);
  const wizardDefaultsPath = join(configRoot, 'wizard.defaults.json');

  return {
    configRoot,
    presetsPath,
    voicesPath,
    studentsDir,
    wizardDefaultsPath,
  };
}

export type CreatePipelineOptions = ResolveConfigPathsOptions & {
  defaultOutDir?: string;
  manifestStore?: ManifestStore;
  configProvider?: ConfigProvider;
  configProviderConfig?: { type: 'remote'; options: RemoteConfigProviderOptions };
  manifestStoreConfig?: { type: 's3'; options: S3ManifestStoreOptions };
  logger?: PipelineLogger;
  metrics?: PipelineMetrics;
};

export type PipelineNewAssignmentOptions = NewAssignmentFlags;
export type PipelineRerunOptions = RerunFlags;

export interface OrchestratorPipeline {
  configPaths: ResolvedConfigPaths;
  defaults: {
    presetsPath: string;
    voicesPath: string;
    outDir?: string;
  };
  manifestStore: ManifestStore;
  configProvider: ConfigProvider;
  logger: PipelineLogger;
  metrics: PipelineMetrics;
  newAssignment(
    flags: PipelineNewAssignmentOptions,
    callbacks?: AssignmentProgressCallbacks,
  ): Promise<Awaited<ReturnType<OrchestratorModule['newAssignment']>>>;
  rerunAssignment(
    flags: PipelineRerunOptions,
  ): Promise<Awaited<ReturnType<OrchestratorModule['rerunAssignment']>>>;
  getAssignmentStatus(
    mdPath: string,
  ): Promise<Awaited<ReturnType<OrchestratorModule['getAssignmentStatus']>>>;
}

export function createPipeline(options: CreatePipelineOptions = {}): OrchestratorPipeline {
  const configPaths = resolveConfigPaths(options);
  const defaults = {
    presetsPath: options.presetsPath
      ? resolvePath(options.presetsPath, options.cwd ?? process.cwd())
      : configPaths.presetsPath,
    voicesPath: options.voicesPath
      ? resolvePath(options.voicesPath, options.cwd ?? process.cwd())
      : configPaths.voicesPath,
    outDir: options.defaultOutDir
      ? resolvePath(options.defaultOutDir, options.cwd ?? process.cwd())
      : undefined,
  };

  // Add new validation checks as per the user's request, ensuring correct placement
  if (!existsSync(defaults.presetsPath)) {
    throw new ConfigurationError(`Presets file not found at ${defaults.presetsPath}`);
  }
  if (!existsSync(defaults.voicesPath)) {
    throw new ConfigurationError(`Voices file not found at ${defaults.voicesPath}`);
  }

  const manifestStore = resolveManifestStore(options);
  const configProvider = resolveConfigProvider(options, configPaths);
  const logger = options.logger ?? noopLogger;
  const metrics = options.metrics ?? noopMetrics;

  return {
    configPaths,
    defaults,
    manifestStore,
    configProvider,
    logger,
    metrics,
    async newAssignment(flags, callbacks) {
      const { newAssignment } = await orchestratorModuleLoader();
      const merged: NewAssignmentFlags = {
        ...flags,
        presetsPath: flags.presetsPath ?? defaults.presetsPath,
        voices: flags.voices ?? defaults.voicesPath,
      };
      if (!merged.out && defaults.outDir) {
        merged.out = defaults.outDir;
      }
      return newAssignment(merged, callbacks, { manifestStore, configProvider, logger, metrics });
    },
    async rerunAssignment(flags) {
      const { rerunAssignment } = await orchestratorModuleLoader();
      const merged: RerunFlags = {
        ...flags,
        voices: flags.voices ?? defaults.voicesPath,
      };
      if (!merged.out && defaults.outDir) {
        merged.out = defaults.outDir;
      }
      return rerunAssignment(merged, { manifestStore, configProvider, logger, metrics });
    },
    async getAssignmentStatus(mdPath: string) {
      const { getAssignmentStatus } = await orchestratorModuleLoader();
      return getAssignmentStatus(mdPath, { manifestStore, configProvider, logger, metrics });
    },
  };
}

function resolveManifestStore(options: CreatePipelineOptions): ManifestStore {
  if (options.manifestStore) return options.manifestStore;

  if (options.manifestStoreConfig?.type === 's3') {
    return new S3ManifestStore(options.manifestStoreConfig.options);
  }

  const config = resolveManifestStoreConfig({ cwd: options.cwd });
  if (config.type === 's3' && config.s3Options) {
    return new S3ManifestStore({
      bucket: config.s3Options.bucket,
      prefix: config.s3Options.prefix,
      region: config.s3Options.region,
      rootDir: config.s3Options.rootDir,
    });
  }

  return createFilesystemManifestStore();
}

function resolveConfigProvider(
  options: CreatePipelineOptions,
  configPaths: ResolvedConfigPaths,
): ConfigProvider {
  if (options.configProvider) return options.configProvider;

  if (options.configProviderConfig?.type === 'remote') {
    return new RemoteConfigProvider(options.configProviderConfig.options);
  }

  const envProvider = process.env.ESL_PIPELINE_CONFIG_PROVIDER?.toLowerCase();
  if (envProvider === 'remote' || envProvider === 'http') {
    const baseUrl = process.env.ESL_PIPELINE_CONFIG_ENDPOINT;
    if (!baseUrl) {
      throw new ConfigurationError(
        'ESL_PIPELINE_CONFIG_ENDPOINT must be set when ESL_PIPELINE_CONFIG_PROVIDER is remote/http.',
      );
    }
    return new RemoteConfigProvider({
      baseUrl,
      token: process.env.ESL_PIPELINE_CONFIG_TOKEN,
      presetsPath: process.env.ESL_PIPELINE_CONFIG_PRESETS_PATH,
      studentsPath: process.env.ESL_PIPELINE_CONFIG_STUDENTS_PATH,
      voicesPath: process.env.ESL_PIPELINE_CONFIG_VOICES_PATH,
    });
  }

  return createFilesystemConfigProvider({
    presetsPath: configPaths.presetsPath,
    voicesPath: configPaths.voicesPath,
    studentsDir: configPaths.studentsDir,
  });
}

function findFirstExistingPath(paths: string[]): string | undefined {
  for (const path of paths) {
    if (path && existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

function resolvePath(input: string, base: string): string {
  return isAbsolute(input) ? input : resolve(base, input);
}

export function resolveManifestPath(mdPath: string): string {
  return manifestPathFor(mdPath);
}

export {
  type LoadEnvOptions,
  type LoadEnvSummary,
  loadEnvFiles,
  loadEnvFilesWithSummary,
} from '@esl-pipeline/shared-infrastructure';
