#!/usr/bin/env node
import { buildStaleActiveReport, writeStaleActiveArtifacts } from './docs-gardening-lib.mjs';

const repoRoot = process.cwd();
const report = buildStaleActiveReport({ repoRoot });
const artifacts = writeStaleActiveArtifacts(report, { repoRoot });

console.log(`stale active docs report written:\n- ${artifacts.jsonPath}\n- ${artifacts.mdPath}`);
