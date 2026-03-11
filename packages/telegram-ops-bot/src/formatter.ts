import type { JobListResponse, JobStatusDto, OpsActionStatus, OpsStatusResponse } from '@esl-pipeline/contracts';

import type { CommandDefinition } from './types.js';

const STUDY_TEXT_AUDIO_LINK_LABEL = 'Audio recording: Study Text';
const PRONUNCIATION_AUDIO_LINK_LABEL = 'Audio recording: Pronunciation Shadow Sentence';

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatNullable(value: string | null | undefined): string {
  if (!value) return 'n/a';
  return value;
}

export function formatHelp(commands: CommandDefinition[]): string {
  const lines = [...commands]
    .sort((a, b) => a.command.localeCompare(b.command))
    .map((command) => `<code>/${escapeHtml(command.command)}</code> — ${escapeHtml(command.description)}`);

  return `<b>ESL Ops Control</b>\n\n${lines.join('\n')}`;
}

export function formatOpsStatus(status: OpsStatusResponse): string {
  const emoji =
    status.overall.state === 'healthy' ? '✅' : status.overall.state === 'degraded' ? '⚠️' : '❌';
  const reasons = status.overall.reasons.length > 0 ? status.overall.reasons : ['All checks healthy'];

  return [
    `<b>${emoji} Ops Status: ${escapeHtml(status.overall.state.toUpperCase())}</b>`,
    `<code>${escapeHtml(status.checkedAtUtc)}</code>`,
    '',
    `<b>Backup</b> ${escapeHtml(status.backup.state)} • ${escapeHtml(status.backup.reason)}`,
    `<b>Drill</b> ${escapeHtml(status.restoreDrill.state)} • ${escapeHtml(status.restoreDrill.reason)}`,
    `<b>Keys</b> ${escapeHtml(status.keyRotation.state)} • ${escapeHtml(status.keyRotation.reason)}`,
    '',
    `<b>Reasons</b>`,
    ...reasons.map((reason) => `• ${escapeHtml(reason)}`),
  ].join('\n');
}

export function formatFinishedJobs(response: JobListResponse): string {
  if (response.jobs.length === 0) {
    return '<b>Finished jobs</b>\n\nNo succeeded jobs found.';
  }

  const lines = response.jobs.slice(0, 10).map((job) => {
    const label = job.learningPresetId ?? job.preset ?? 'unknown';
    return `• <code>${escapeHtml(job.jobId)}</code> — ${escapeHtml(label)} (${escapeHtml(job.finishedAt ?? job.updatedAt)})`;
  });

  return `<b>Finished jobs</b>\n\n${lines.join('\n')}`;
}

export function formatJobDetails(job: JobStatusDto): string {
  return [
    `<b>Job ${escapeHtml(job.state.toUpperCase())}</b>`,
    `<code>${escapeHtml(job.jobId)}</code>`,
    '',
    `<b>Student</b> ${escapeHtml(formatNullable(job.studentId))}`,
    `<b>Created</b> <code>${escapeHtml(job.createdAt)}</code>`,
    `<b>Finished</b> <code>${escapeHtml(formatNullable(job.finishedAt))}</code>`,
    `<b>Preset</b> ${escapeHtml(formatNullable(job.learningPresetId ?? job.preset))}`,
    `<b>Error</b> ${escapeHtml(formatNullable(job.error))}`,
  ].join('\n');
}

export function formatJobLinks(
  job: JobStatusDto,
  appBaseUrl?: string,
  options?: {
    studyTextAudioUrl?: string | null;
    pronunciationAudioUrl?: string | null;
    includeAudioLinks?: boolean;
    assignmentTitle?: string | null;
    assignmentEmoji?: string | null;
  },
): string {
  const assignmentUrl = job.htmlUrl ?? job.notionUrl ?? job.anytypeUrl ?? resolveAppJobUrl(job.jobId, appBaseUrl);
  const includeAudioLinks = options?.includeAudioLinks ?? true;
  const assignmentTitle = normalizeAssignmentTitle(options?.assignmentTitle);
  const headingText =
    assignmentTitle && assignmentTitle.toLowerCase() !== 'homework assignment'
      ? `Homework Assignment: ${assignmentTitle}`
      : 'Homework Assignment';
  const assignmentLabel = [normalizeAssignmentEmoji(options?.assignmentEmoji), headingText]
    .filter(Boolean)
    .join(' ');
  const studyTextAudioUrl =
    options?.studyTextAudioUrl ??
    resolveAudioUrlFromMarkdown(job.md, STUDY_TEXT_AUDIO_LINK_LABEL, '/audio/final/');
  const pronunciationAudioUrl =
    options?.pronunciationAudioUrl ??
    resolveAudioUrlFromMarkdown(job.md, PRONUNCIATION_AUDIO_LINK_LABEL, '/audio/pronunciation-shadow/');

  const lines: string[] = [];
  if (assignmentUrl) {
    lines.push(`<a href="${escapeHtml(assignmentUrl)}">${escapeHtml(assignmentLabel)}</a>`);
  } else {
    lines.push(`<b>${escapeHtml(assignmentLabel)}</b>`);
  }

  if (!includeAudioLinks) {
    return lines.join('\n');
  }

  if (includeAudioLinks) {
    if (studyTextAudioUrl) {
      lines.push(`• <a href="${escapeHtml(studyTextAudioUrl)}">🎧 Listen 1: Study Text</a>`);
    }
    if (pronunciationAudioUrl) {
      lines.push(
        `• <a href="${escapeHtml(pronunciationAudioUrl)}">🗣️ Listen 2: Pronunciation</a>`,
      );
    }
  }

  return lines.join('\n');
}

export function formatAudioPlaybackLink(label: string, url: string): string {
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);
  return `<a href="${safeUrl}">${safeLabel}</a>`;
}

function resolveAppJobUrl(jobId: string, appBaseUrl?: string): string | null {
  if (!appBaseUrl) return null;
  const normalized = appBaseUrl.replace(/\/+$/, '');
  return `${normalized}/jobs/${encodeURIComponent(jobId)}`;
}

function resolveAudioUrlFromMarkdown(
  markdown: string | null | undefined,
  linkLabel: string,
  pathHint: string,
): string | null {
  if (!markdown) return null;

  const labelRegex = new RegExp(`\\[${escapeRegExp(linkLabel)}\\]\\((https?:\\/\\/[^\\s)]+)\\)`, 'i');
  const labeledMatch = markdown.match(labelRegex);
  if (labeledMatch?.[1]) {
    return labeledMatch[1];
  }

  const hintedRegex = new RegExp(`(https?:\\/\\/\\S*${escapeRegExp(pathHint)}\\S*\\.mp3(?:\\?\\S*)?)`, 'i');
  const hintedMatch = markdown.match(hintedRegex);
  if (hintedMatch?.[1]) {
    return hintedMatch[1];
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAssignmentTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^homework\s+ass+i?ignment\s*:\s*/i, '').trim() || null;
}

function normalizeAssignmentEmoji(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function formatActionQueued(status: OpsActionStatus): string {
  return [
    '<b>⏳ Action queued</b>',
    `<b>Action</b> <code>${escapeHtml(status.action)}</code>`,
    `<b>Operation</b> <code>${escapeHtml(status.operationId)}</code>`,
    `<b>State</b> <code>${escapeHtml(status.state)}</code>`,
    `<b>Requested</b> <code>${escapeHtml(status.requestedAt)}</code>`,
  ].join('\n');
}

export function formatActionStatus(status: OpsActionStatus): string {
  const emoji =
    status.state === 'succeeded' ? '✅' : status.state === 'failed' ? '❌' : status.state === 'running' ? '▶️' : '⏳';
  return [
    `<b>${emoji} Action status</b>`,
    `<b>Action</b> <code>${escapeHtml(status.action)}</code>`,
    `<b>Operation</b> <code>${escapeHtml(status.operationId)}</code>`,
    `<b>State</b> <code>${escapeHtml(status.state)}</code>`,
    `<b>Requested</b> <code>${escapeHtml(status.requestedAt)}</code>`,
    `<b>Started</b> <code>${escapeHtml(formatNullable(status.startedAt))}</code>`,
    `<b>Finished</b> <code>${escapeHtml(formatNullable(status.finishedAt))}</code>`,
    `<b>Exit</b> <code>${escapeHtml(formatNullable(status.exitCode === null ? null : String(status.exitCode)))}</code>`,
    `<b>Message</b> ${escapeHtml(formatNullable(status.message))}`,
  ].join('\n');
}

export function formatCommandError(message: string): string {
  return `<b>Command failed</b>\n\n${escapeHtml(message)}`;
}
