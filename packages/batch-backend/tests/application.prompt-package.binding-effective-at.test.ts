import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import {
  createConfig,
  createProfileRevisionRepositoryStub,
  createPromptOptionsStub,
  createPromptPackageRepositoryStub,
  createStorageStub,
  createTemplateRevisionRepositoryStub,
  createTranscriptRecord,
} from './application.prompt-package.test-harness.js';

describe('application/prompt-package', () => {
  it('resolves binding using recording creation time by default', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const boundProfilePath = path.join(allowedDir, 'profiles', 'bound.md');

    await fs.mkdir(path.dirname(boundProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(boundProfilePath, 'BOUND PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const recordingCreatedAt = new Date('2024-02-01T12:00:00.000Z');
    const resolvedAt: Date[] = [];

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        workspaceId: 'workspace-1',
        templateId: 'template.md',
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage: createStorageStub({
          getText: async () => 'TRANSCRIPT BODY',
        }),
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: recordingCreatedAt,
            updatedAt: recordingCreatedAt,
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: null,
          }),
        },
        bindings: {
          resolveAt: async (_studentId, at) => {
            resolvedAt.push(at);
            return {
              id: 'binding-1',
              studentId: 'student-1',
              profileId: 'profiles/bound.md',
              effectiveFrom: recordingCreatedAt.toISOString(),
              effectiveTo: null,
              reason: null,
              changedBy: null,
              createdAt: recordingCreatedAt.toISOString(),
            };
          },
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub(),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(resolvedAt).toHaveLength(1);
    expect(resolvedAt[0]?.toISOString()).toBe(recordingCreatedAt.toISOString());
    expect(result?.profilePath).toBe('profiles/bound.md');
  });

  it('supports explicit bindingEffectiveAt override for replay diagnostics', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const boundProfilePath = path.join(allowedDir, 'profiles', 'bound.md');

    await fs.mkdir(path.dirname(boundProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(boundProfilePath, 'BOUND PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const recordingCreatedAt = new Date('2024-02-01T12:00:00.000Z');
    const bindingEffectiveAt = new Date('2024-03-04T15:30:00.000Z');
    const resolvedAt: Date[] = [];

    await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        workspaceId: 'workspace-1',
        templateId: 'template.md',
        bindingEffectiveAt,
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage: createStorageStub({
          getText: async () => 'TRANSCRIPT BODY',
        }),
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: recordingCreatedAt,
            updatedAt: recordingCreatedAt,
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: null,
          }),
        },
        bindings: {
          resolveAt: async (_studentId, at) => {
            resolvedAt.push(at);
            return {
              id: 'binding-1',
              studentId: 'student-1',
              profileId: 'profiles/bound.md',
              effectiveFrom: at.toISOString(),
              effectiveTo: null,
              reason: null,
              changedBy: null,
              createdAt: at.toISOString(),
            };
          },
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub(),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(resolvedAt).toHaveLength(1);
    expect(resolvedAt[0]?.toISOString()).toBe(bindingEffectiveAt.toISOString());
  });
});
