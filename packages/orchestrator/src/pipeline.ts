import { existsSync } from 'node:fs';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import type { AssignmentProgressCallbacks, NewAssignmentFlags, RerunFlags } from './index.js';
import { manifestPathFor, createFilesystemManifestStore } from './manifest.js';
import type { ManifestStore } from './manifest.js';
import { createFilesystemConfigProvider } from './config.js';
import type { ConfigProvider } from './config.js';

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
  const wizardDefaultsPath = resolve(cwd, 'configs', 'wizard.defaults.json');

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

  const manifestStore = options.manifestStore ?? createFilesystemManifestStore();
  const configProvider =
    options.configProvider ??
    createFilesystemConfigProvider({
      presetsPath: configPaths.presetsPath,
      voicesPath: configPaths.voicesPath,
      studentsDir: configPaths.studentsDir,
    });

  return {
    configPaths,
    defaults,
    manifestStore,
    configProvider,
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
      return newAssignment(merged, callbacks, { manifestStore, configProvider });
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
      return rerunAssignment(merged, { manifestStore, configProvider });
    },
    async getAssignmentStatus(mdPath: string) {
      const { getAssignmentStatus } = await orchestratorModuleLoader();
      return getAssignmentStatus(mdPath, { manifestStore, configProvider });
    },
  };
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
  const envTarget: Record<string, string> = assignToProcess
    ? (process.env as unknown as Record<string, string>)
    : {};
  const collected: Record<string, string> = {};

  for (const file of files) {
    if (!existsSync(file)) continue;
    const result = loadDotEnv({
      path: file,
      override,
      processEnv: envTarget,
    });
    if (result.parsed) {
      Object.assign(collected, result.parsed);
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
