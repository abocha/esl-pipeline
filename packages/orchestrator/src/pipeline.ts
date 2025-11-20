import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { AssignmentProgressCallbacks, NewAssignmentFlags, RerunFlags } from './index.js';
import { manifestPathFor, createFilesystemManifestStore } from './manifest.js';
import type { ManifestStore } from './manifest.js';
import { createFilesystemConfigProvider } from './config.js';
import type { ConfigProvider } from './config.js';
import {
  noopLogger,
  noopMetrics,
  type PipelineLogger,
  type PipelineMetrics,
} from './observability.js';
import { S3ManifestStore, type S3ManifestStoreOptions } from './adapters/manifest/s3.js';
import {
  RemoteConfigProvider,
  type RemoteConfigProviderOptions,
} from './adapters/config/remote.js';

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

export type ResolveConfigPathsOptions = {
  cwd?: string;
  configDir?: string;
  presetsPath?: string;
  voicesPath?: string;
  studentsDir?: string;
};

export type ResolvedConfigPaths = {
  configRoot: string;
  presetsPath: string;
  voicesPath: string;
  studentsDir: string;
  wizardDefaultsPath: string;
};

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
    .map(dir => resolve(String(dir)));

  const presetsPath =
    options.presetsPath && existsSync(resolvePath(options.presetsPath, cwd))
      ? resolvePath(options.presetsPath, cwd)
      : findFirstExistingPath(candidateConfigDirs.map(dir => join(dir, 'presets.json')));

  if (!presetsPath) {
    throw new Error(
      `Unable to locate presets.json. Checked: ${candidateConfigDirs
        .map(dir => join(dir, 'presets.json'))
        .join(', ')}`
    );
  }

  const voicesPath =
    options.voicesPath && existsSync(resolvePath(options.voicesPath, cwd))
      ? resolvePath(options.voicesPath, cwd)
      : findFirstExistingPath(candidateConfigDirs.map(dir => join(dir, 'voices.yml')));

  if (!voicesPath) {
    throw new Error(
      `Unable to locate voices.yml. Checked: ${candidateConfigDirs
        .map(dir => join(dir, 'voices.yml'))
        .join(', ')}`
    );
  }

  const studentsDir =
    options.studentsDir && existsSync(resolvePath(options.studentsDir, cwd))
      ? resolvePath(options.studentsDir, cwd)
      : findFirstExistingPath(candidateConfigDirs.map(dir => join(dir, 'students')));

  if (!studentsDir) {
    throw new Error(
      `Unable to locate students directory. Checked: ${candidateConfigDirs
        .map(dir => join(dir, 'students'))
        .join(', ')}`
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

export type OrchestratorPipeline = {
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
    callbacks?: AssignmentProgressCallbacks
  ): Promise<Awaited<ReturnType<OrchestratorModule['newAssignment']>>>;
  rerunAssignment(
    flags: PipelineRerunOptions
  ): Promise<Awaited<ReturnType<OrchestratorModule['rerunAssignment']>>>;
  getAssignmentStatus(
    mdPath: string
  ): Promise<Awaited<ReturnType<OrchestratorModule['getAssignmentStatus']>>>;
};

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

  const envBackend = process.env.ESL_PIPELINE_MANIFEST_STORE?.toLowerCase();
  if (envBackend === 's3') {
    const bucket = process.env.ESL_PIPELINE_MANIFEST_BUCKET;
    if (!bucket) {
      throw new Error(
        'ESL_PIPELINE_MANIFEST_BUCKET must be set when ESL_PIPELINE_MANIFEST_STORE is "s3".'
      );
    }
    const prefix = process.env.ESL_PIPELINE_MANIFEST_PREFIX;
    const rootDir = process.env.ESL_PIPELINE_MANIFEST_ROOT ?? options.cwd ?? process.cwd();
    return new S3ManifestStore({
      bucket,
      prefix,
      region: process.env.AWS_REGION,
      rootDir,
    });
  }

  return createFilesystemManifestStore();
}

function resolveConfigProvider(
  options: CreatePipelineOptions,
  configPaths: ResolvedConfigPaths
): ConfigProvider {
  if (options.configProvider) return options.configProvider;

  if (options.configProviderConfig?.type === 'remote') {
    return new RemoteConfigProvider(options.configProviderConfig.options);
  }

  const envProvider = process.env.ESL_PIPELINE_CONFIG_PROVIDER?.toLowerCase();
  if (envProvider === 'remote' || envProvider === 'http') {
    const baseUrl = process.env.ESL_PIPELINE_CONFIG_ENDPOINT;
    if (!baseUrl) {
      throw new Error(
        'ESL_PIPELINE_CONFIG_ENDPOINT must be set when ESL_PIPELINE_CONFIG_PROVIDER is remote/http.'
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

export type LoadEnvOptions = {
  cwd?: string;
  files?: string[];
  override?: boolean;
  assignToProcess?: boolean;
};

export function loadEnvFiles(options: LoadEnvOptions = {}): Record<string, string> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const files = (options.files && options.files.length > 0 ? options.files : ['.env']).map(file =>
    isAbsolute(file) ? file : resolve(cwd, file)
  );
  const override = options.override ?? false;
  const assignToProcess = options.assignToProcess ?? true;

  const collected: Record<string, string> = {};

  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, 'utf8');
      const parsed = parseEnv(content);

      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined) continue;

        // Update collected map
        if (override || collected[key] === undefined) {
          collected[key] = value;
        }

        // Update process.env if requested
        if (assignToProcess) {
          if (override || process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      }
    } catch {
      // Ignore parsing errors to match dotenv behavior (mostly)
      // or log debug if we had a logger here
    }
  }

  return collected;
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
