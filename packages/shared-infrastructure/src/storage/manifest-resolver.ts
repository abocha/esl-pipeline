/**
 * Manifest store configuration resolution utilities.
 * Extracted from orchestrator/src/pipeline.ts:resolveManifestStore
 */

import { readString } from '../env/loaders.js';
import { ConfigurationError } from '@esl-pipeline/contracts';

export interface ManifestStoreOptions {
    type?: 's3' | 'filesystem';
    s3Options?: {
        bucket?: string;
        prefix?: string;
        region?: string;
        rootDir?: string;
    };
    cwd?: string;
}

export interface ResolvedManifestStoreConfig {
    type: 's3' | 'filesystem';
    s3Options?: {
        bucket: string;
        prefix?: string;
        region?: string;
        rootDir: string;
    };
}

/**
 * Resolve manifest store configuration from environment and options
 * Extracted from orchestrator/src/pipeline.ts:resolveManifestStore
 */
export function resolveManifestStoreConfig(
    options: ManifestStoreOptions = {}
): ResolvedManifestStoreConfig {
    const envBackend = readString('ESL_PIPELINE_MANIFEST_STORE')?.toLowerCase();

    if (options.type === 's3' || envBackend === 's3') {
        const bucket = options.s3Options?.bucket || readString('ESL_PIPELINE_MANIFEST_BUCKET');
        if (!bucket) {
            throw new ConfigurationError(
                'ESL_PIPELINE_MANIFEST_BUCKET must be set when ESL_PIPELINE_MANIFEST_STORE is "s3".'
            );
        }
        const prefix = options.s3Options?.prefix || readString('ESL_PIPELINE_MANIFEST_PREFIX');
        const rootDir =
            options.s3Options?.rootDir ||
            readString('ESL_PIPELINE_MANIFEST_ROOT') ||
            options.cwd ||
            process.cwd();
        const region = options.s3Options?.region || readString('AWS_REGION');

        return {
            type: 's3',
            s3Options: { bucket, prefix, region, rootDir },
        };
    }

    return { type: 'filesystem' };
}
