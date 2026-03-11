import type { JobListResponse, JobStatusDto, OpsActionStatus, OpsStatusResponse } from '@esl-pipeline/contracts';

import type { CommandDefinition } from './types.js';

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

export function formatJobLinks(job: JobStatusDto, appBaseUrl?: string): string {
  const links: string[] = [];
  if (job.notionUrl) links.push(`<a href="${escapeHtml(job.notionUrl)}">Notion</a>`);
  if (job.anytypeUrl) links.push(`<a href="${escapeHtml(job.anytypeUrl)}">Anytype</a>`);
  if (job.htmlUrl) links.push(`<a href="${escapeHtml(job.htmlUrl)}">HTML</a>`);

  if (appBaseUrl) {
    const normalized = appBaseUrl.replace(/\/+$/, '');
    links.push(`<a href="${escapeHtml(`${normalized}/jobs/${encodeURIComponent(job.jobId)}`)}">App job</a>`);
    if (job.recordingId) {
      links.push(
        `<a href="${escapeHtml(`${normalized}/recordings/${encodeURIComponent(job.recordingId)}`)}">Recording</a>`,
      );
    }
  }

  if (links.length === 0) {
    return `<b>Links</b>\n\nNo links available for <code>${escapeHtml(job.jobId)}</code>.`;
  }

  return [`<b>Links for <code>${escapeHtml(job.jobId)}</code></b>`, '', ...links.map((link) => `• ${link}`)].join(
    '\n',
  );
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

export function formatCommandError(message: string): string {
  return `<b>Command failed</b>\n\n${escapeHtml(message)}`;
}
