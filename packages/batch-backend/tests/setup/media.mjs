import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { configureMediaTestEnvironment } from './project-env.mjs';

const ambientKeys = new Set(Object.keys(process.env));
loadBatchBackendEnv(import.meta.url, 'batch-backend-vitest-media-project');
configureMediaTestEnvironment(process.env, { preserveKeys: ambientKeys });
