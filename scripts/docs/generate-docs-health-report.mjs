#!/usr/bin/env node
import { buildDocsHealthReport, writeDocsHealthReportArtifacts } from './docs-gardening-lib.mjs';

const repoRoot = process.cwd();
const report = buildDocsHealthReport({ repoRoot });
const artifacts = writeDocsHealthReportArtifacts(report, { repoRoot });

console.log(`docs health report written:\n- ${artifacts.jsonPath}\n- ${artifacts.mdPath}`);
