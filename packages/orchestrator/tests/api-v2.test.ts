import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PipelineCancelledError,
  categorizeOrchestratorError,
  executeGetAssignmentStatusV2,
  executeNewAssignmentV2,
  executePlanRerunAssignmentV2,
  executeRerunAssignmentV2,
} from '../src/index.js';

const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');

describe('orchestrator api v2', () => {
  it('executes new assignment with v2 envelope and emits v2 stage events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-v2-new-'));
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, await readFile(okFixturePath, 'utf8'));

    const events: { schemaVersion: string; operation: string; stage: string; status: string }[] = [];
    const result = await executeNewAssignmentV2(
      {
        assignment: {
          md: mdPath,
          skipImport: true,
          skipTts: true,
          skipUpload: true,
          upload: 's3',
          dryRun: true,
        },
      },
      {
        onStageEvent: (event) => {
          events.push({
            schemaVersion: event.schemaVersion,
            operation: event.operation,
            stage: event.stage,
            status: event.status,
          });
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.schemaVersion).toBe('v2');
    expect(result.operation).toBe('new_assignment');
    if (result.ok) {
      expect(result.data.manifestPath).toBeDefined();
      expect(result.data.steps).toContain('manifest');
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.schemaVersion === 'v2')).toBe(true);
    expect(events.every((event) => event.operation === 'new_assignment')).toBe(true);
  });

  it('returns categorized validation failure for rerun v2 without manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-v2-rerun-'));
    const mdPath = join(dir, 'missing.manifest.md');
    await writeFile(mdPath, await readFile(okFixturePath, 'utf8'));

    const result = await executeRerunAssignmentV2({
      assignment: {
        md: mdPath,
        steps: ['upload'],
        upload: 's3',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.schemaVersion).toBe('v2');
    expect(result.operation).toBe('rerun_assignment');
    if (!result.ok) {
      expect(result.error.category).toBe('validation');
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('supports v2 status and rerun planning DTOs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-v2-status-plan-'));
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, await readFile(okFixturePath, 'utf8'));

    const status = await executeGetAssignmentStatusV2({ mdPath });
    const plan = await executePlanRerunAssignmentV2({ rerunPlan: { md: mdPath } });

    expect(status.ok).toBe(true);
    expect(status.schemaVersion).toBe('v2');
    expect(status.operation).toBe('get_assignment_status');
    if (status.ok) {
      expect(status.data.manifest).toBeNull();
      expect(status.data.audioFileExists).toBe(false);
    }

    expect(plan.ok).toBe(true);
    expect(plan.schemaVersion).toBe('v2');
    expect(plan.operation).toBe('plan_rerun_assignment');
    if (plan.ok) {
      expect(plan.data.errors.length).toBeGreaterThan(0);
    }
  });

  it('categorizes cancellation errors with stable v2 schema', () => {
    const cancelled = new PipelineCancelledError('tts', 'manual stop');
    const categorized = categorizeOrchestratorError('new_assignment', cancelled);
    expect(categorized.schemaVersion).toBe('v2');
    expect(categorized.category).toBe('cancelled');
    expect(categorized.code).toBe('PIPELINE_CANCELLED');
    expect(categorized.stage).toBe('tts');
  });
});
