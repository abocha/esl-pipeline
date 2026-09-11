import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { configureDeterministicHttpTestEnvironment } from './project-env.mjs';

const ambientKeys = new Set(Object.keys(process.env));
loadBatchBackendEnv(import.meta.url, 'batch-backend-vitest-http-project');
configureDeterministicHttpTestEnvironment(process.env, { preserveKeys: ambientKeys });
