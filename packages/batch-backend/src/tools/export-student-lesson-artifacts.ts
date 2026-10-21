import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  loadStudentLessonArtifactExportPlan,
  renderHomeworkMemoryText,
  renderLessonIndexText,
  renderLessonMemoryText,
  renderLessonSummaryText,
  renderReadmeText,
} from '../application/student-lesson-artifact-export.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { loadConfig } from '../config/env.js';
import { closePgPool } from '../infrastructure/db.js';

interface CliOptions {
  studentId: string;
  outPath: string | null;
}

const studentIdSchema = z.string().uuid();

function timestampForFile(value: Date): string {
  return value.toISOString().replaceAll(':', '-').replaceAll('.000', '');
}

function defaultZipBaseName(studentId: string, now = new Date()): string {
  return `${studentId}_lesson-artifacts_${timestampForFile(now)}.zip`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureParentDir(targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
}

async function writeTextFile(targetPath: string, content: string): Promise<void> {
  await ensureParentDir(targetPath);
  await writeFile(targetPath, ensureTrailingNewline(content), 'utf8');
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function zipDirectory(stagingDir: string, zipPath: string): Promise<void> {
  try {
    await runCommand('zip', ['-rq', zipPath, '.'], stagingDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/i.test(message)) {
      throw new Error('zip command not found on PATH. Install zip and rerun the export.');
    }
    throw error;
  }
}

async function resolveZipPath(studentId: string, outPath: string | null): Promise<string> {
  if (!outPath) {
    const defaultDir = path.resolve(process.cwd(), 'tmp', 'student-lesson-artifacts');
    await mkdir(defaultDir, { recursive: true });
    return path.join(defaultDir, defaultZipBaseName(studentId));
  }

  const resolved = path.resolve(process.cwd(), outPath);
  if (resolved.toLowerCase().endsWith('.zip')) {
    return resolved;
  }

  await mkdir(resolved, { recursive: true });
  return path.join(resolved, defaultZipBaseName(studentId));
}

async function createStagingDir(studentId: string): Promise<string> {
  const repoTmpRoot = path.resolve(process.cwd(), 'tmp', 'student-lesson-artifacts');
  await mkdir(repoTmpRoot, { recursive: true });
  return mkdtemp(path.join(repoTmpRoot, `${studentId}-stage-`));
}

async function writeUnmatchedHomeworkFolder(args: {
  stagingDir: string;
  unmatchedHomeworkMemories: Awaited<
    ReturnType<typeof loadStudentLessonArtifactExportPlan>
  > extends infer T
    ? T extends { unmatchedHomeworkMemories: infer U }
      ? U
      : never
    : never;
}): Promise<void> {
  if (args.unmatchedHomeworkMemories.length === 0) {
    return;
  }

  const folderPath = path.join(args.stagingDir, 'unmatched-homework-memory');
  await mkdir(folderPath, { recursive: true });
  await writeTextFile(
    path.join(folderPath, '00-summary.txt'),
    [
      `Unmatched Homework Memories: ${args.unmatchedHomeworkMemories.length}`,
      'These homework memory files could not be tied back to a transcript or recording.',
    ].join('\n'),
  );

  for (const [index, memory] of args.unmatchedHomeworkMemories.entries()) {
    const fileName = `${String(index + 1).padStart(2, '0')}-homework-memory-${memory.id}.txt`;
    await writeTextFile(path.join(folderPath, fileName), renderHomeworkMemoryText(memory));
  }
}

async function stageExport(args: {
  stagingDir: string;
  plan: NonNullable<Awaited<ReturnType<typeof loadStudentLessonArtifactExportPlan>>>;
}): Promise<void> {
  await writeTextFile(path.join(args.stagingDir, 'README.txt'), renderReadmeText(args.plan));
  await writeTextFile(
    path.join(args.stagingDir, 'LESSON_INDEX.txt'),
    renderLessonIndexText(args.plan),
  );

  for (const lesson of args.plan.lessons) {
    const lessonDir = path.join(args.stagingDir, lesson.folderName);
    await mkdir(lessonDir, { recursive: true });
    await writeTextFile(
      path.join(lessonDir, '00-summary.txt'),
      renderLessonSummaryText({
        studentName: args.plan.student.student,
        lesson,
      }),
    );
    await writeTextFile(path.join(lessonDir, '01-transcript.txt'), lesson.transcriptText);

    if (lesson.lessonMemory) {
      await writeTextFile(
        path.join(lessonDir, '02-lesson-memory.txt'),
        renderLessonMemoryText(lesson.lessonMemory),
      );
    }

    if (lesson.homeworkMemories.length === 1) {
      const onlyHomeworkMemory = lesson.homeworkMemories[0];
      if (onlyHomeworkMemory) {
        await writeTextFile(
          path.join(lessonDir, '03-homework-memory.txt'),
          renderHomeworkMemoryText(onlyHomeworkMemory),
        );
        continue;
      }
    }

    for (const [index, memory] of lesson.homeworkMemories.entries()) {
      const fileName = `03-homework-memory-${String(index + 1).padStart(2, '0')}.txt`;
      await writeTextFile(path.join(lessonDir, fileName), renderHomeworkMemoryText(memory));
    }
  }

  await writeUnmatchedHomeworkFolder({
    stagingDir: args.stagingDir,
    unmatchedHomeworkMemories: args.plan.unmatchedHomeworkMemories,
  });
}

export function parseArgs(argv: string[]): CliOptions {
  let studentId: string | null = null;
  let outPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || arg === '--') {
      continue;
    }

    if (arg === '--student-id') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --student-id');
      }
      studentId = value;
      index += 1;
      continue;
    }

    if (arg === '--out') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --out');
      }
      outPath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!studentId) {
    throw new Error('The export requires --student-id <id>');
  }

  const validatedStudentId = studentIdSchema.safeParse(studentId);
  if (!validatedStudentId.success) {
    throw new Error('The export requires --student-id to be a valid UUID.');
  }

  return {
    studentId: validatedStudentId.data,
    outPath,
  };
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-export-student-lesson-artifacts');
  configureHostRunPgRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Student artifact export requires Postgres (PG_ENABLED=true)');
  }

  const plan = await loadStudentLessonArtifactExportPlan({
    studentId: options.studentId,
  });

  if (!plan) {
    throw new Error(`Student not found: ${options.studentId}`);
  }

  if (plan.lessons.length === 0 && plan.unmatchedHomeworkMemories.length === 0) {
    console.log(
      `[student-artifacts-export] no transcripts or ready memory artifacts found for student=${options.studentId}`,
    );
    return;
  }

  const zipPath = await resolveZipPath(options.studentId, options.outPath);
  if (await pathExists(zipPath)) {
    throw new Error(`Output zip already exists: ${zipPath}`);
  }

  const stagingDir = await createStagingDir(options.studentId);

  try {
    await stageExport({
      stagingDir,
      plan,
    });
    await ensureParentDir(zipPath);
    await zipDirectory(stagingDir, zipPath);

    console.log(`[student-artifacts-export] student=${plan.student.id}`);
    console.log(`[student-artifacts-export] lessons=${plan.lessons.length}`);
    console.log(
      `[student-artifacts-export] unmatchedHomework=${plan.unmatchedHomeworkMemories.length}`,
    );
    console.log(`[student-artifacts-export] zip=${zipPath}`);

    await rm(stagingDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`[student-artifacts-export] stagingDir=${stagingDir}`);
    console.error(`[student-artifacts-export] output=${zipPath}`);
    console.error(
      '[student-artifacts-export] staged private learner artifacts remain for operator-controlled recovery or cleanup.',
    );
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[student-artifacts-export] failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePgPool();
    });
}
