import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { configurePureTestEnvironment } from './project-env.mjs';

const ambientKeys = new Set(Object.keys(process.env));
loadBatchBackendEnv(import.meta.url, 'batch-backend-vitest-pure-project');
configurePureTestEnvironment(process.env, { preserveKeys: ambientKeys });
