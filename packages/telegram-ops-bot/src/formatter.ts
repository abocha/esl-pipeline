import type {
  JobListResponse,
  JobStatusDto,
  JobSummaryResponse,
  OpsActionListResponse,
  OpsActionStatus,
  OpsStatusResponse,
  StudentProfileDto,
  StudentSummaryResponse,
} from '@esl-pipeline/contracts';

import type { BotConfig, BotDomain, BotRuntimeSnapshot, CommandDefinition } from './types.js';

const STUDY_TEXT_AUDIO_LINK_LABEL = 'Audio recording: Study Text';
const PRONUNCIATION_AUDIO_LINK_LABEL = 'Audio recording: Pronunciation Practice';
const PRONUNCIATION_AUDIO_PATH_HINTS = ['/audio/pronunciation/'] as const;

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatNullable(value: string | null | undefined): string {
  if (!value) return 'n/a';
  return value;
}

export function formatLocalizedDateTime(value: string | null | undefined): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const iso = parsed.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function formatStudentDisplayName(job: Pick<JobStatusDto, 'studentId' | 'studentName'>): string {
  return formatNullable(job.studentName?.trim() || job.studentId);
}

function formatShortIdentifier(value: string | null | undefined, length = 8): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, length);
}

function formatStudentIdentity(job: Pick<JobStatusDto, 'studentId' | 'studentName'>): string {
  const studentName = job.studentName?.trim();
  const shortStudentId = formatShortIdentifier(job.studentId);
  if (studentName && shortStudentId) {
    return `${studentName} (${shortStudentId})`;
  }
  return formatStudentDisplayName(job);
}

function formatPreset(job: Pick<JobStatusDto, 'learningPresetId' | 'preset'>): string {
  return formatNullable(job.learningPresetId ?? job.preset);
}

function formatJobTimestamp(
  job: Pick<JobStatusDto, 'finishedAt' | 'updatedAt' | 'createdAt'>,
): string {
  return formatLocalizedDateTime(job.finishedAt ?? job.updatedAt ?? job.createdAt);
}

function formatJobListLine(job: JobStatusDto): string {
  return [
    `• <b>${escapeHtml(formatStudentIdentity(job))}</b>`,
    `<b>State</b> ${escapeHtml(job.state)}`,
    `<b>When</b> ${escapeHtml(formatJobTimestamp(job))}`,
    `<b>Preset</b> ${escapeHtml(formatPreset(job))}`,
    `<code>${escapeHtml(job.jobId)}</code>`,
  ].join('\n');
}

function formatStudentSummaryLine(student: StudentSummaryResponse['items'][number]): string {
  const details: string[] = [];
  if (student.lastLessonAt) {
    details.push(`Last lesson ${formatLocalizedDateTime(student.lastLessonAt)}`);
  }
  if (student.pendingDrafts > 0) {
    details.push(`Pending drafts ${student.pendingDrafts}`);
  }
  return [
    `• <b>${escapeHtml(student.name)} (${escapeHtml(student.id.slice(0, 8))})</b>`,
    details.length > 0
      ? details.map((detail) => escapeHtml(detail)).join(' · ')
      : 'No recent activity',
  ].join('\n');
}

export function formatHelp(commands: CommandDefinition[]): string {
  return formatHelpWithOptions(commands);
}

export function formatHelpWithOptions(
  commands: CommandDefinition[],
  options?: {
    title?: string;
    footerLines?: string[];
  },
): string {
  const lines = [...commands]
    .sort((a, b) => a.command.localeCompare(b.command))
    .map(
      (command) =>
        `<code>/${escapeHtml(command.command)}</code> — ${escapeHtml(command.description)}`,
    );

  const footer = options?.footerLines?.filter(Boolean) ?? [];
  return [
    `<b>${escapeHtml(options?.title ?? 'ESL Ops Control')}</b>`,
    '',
    lines.join('\n'),
    ...(footer.length > 0 ? ['', ...footer.map((line) => escapeHtml(line))] : []),
  ].join('\n');
}

export function formatGuidedHelpHome(args: {
  commands: CommandDefinition[];
  enableActionCommands: boolean;
}): string {
  return formatHelpWithOptions(args.commands, {
    title: 'ESL Ops Control Panel',
    footerLines: [
      args.enableActionCommands
        ? 'Guided actions below are enabled for this deployment.'
        : 'This deployment is currently read-only.',
      'Use the buttons below for quick navigation, or keep using slash commands directly.',
    ],
  });
}

export function formatOpsStatus(status: OpsStatusResponse): string {
  const emoji =
    status.overall.state === 'healthy' ? '✅' : status.overall.state === 'degraded' ? '⚠️' : '❌';
  const reasons =
    status.overall.reasons.length > 0 ? status.overall.reasons : ['All checks healthy'];

  return [
    `<b>${emoji} Ops Status: ${escapeHtml(status.overall.state.toUpperCase())}</b>`,
    `<code>${escapeHtml(status.checkedAtUtc)}</code>`,
    '',
    `<b>Backup</b> ${escapeHtml(status.backup.state)} • ${escapeHtml(status.backup.reason)}`,
    `<b>Artifact integrity</b> ${escapeHtml(status.artifactIntegrity.state)} • ${escapeHtml(status.artifactIntegrity.reason)}`,
    `<b>Drill</b> ${escapeHtml(status.restoreDrill.state)} • ${escapeHtml(status.restoreDrill.reason)}`,
    '',
    `<b>Reasons</b>`,
    ...reasons.map((reason) => `• ${escapeHtml(reason)}`),
  ].join('\n');
}

export function formatFinishedJobs(response: JobListResponse): string {
  if (response.jobs.length === 0) {
    return '<b>Jobs · Recent Finished</b>\n\nNo succeeded jobs found.';
  }
  return [
    '<b>Jobs · Recent Finished</b>',
    '',
    `<b>Showing</b> ${response.jobs.length} of ${response.total}`,
    '',
    response.jobs
      .slice(0, 10)
      .map((job) => formatJobListLine(job))
      .join('\n\n'),
  ].join('\n');
}

export function formatJobDetails(
  job: JobStatusDto,
  options?: {
    assignmentTitle?: string | null;
  },
): string {
  const assignmentTitle = normalizeAssignmentTitle(options?.assignmentTitle);
  return [
    `<b>Job · ${escapeHtml(job.state.toUpperCase())}</b>`,
    `<code>${escapeHtml(job.jobId)}</code>`,
    '',
    `<b>Student</b> ${escapeHtml(formatStudentDisplayName(job))}`,
    `<b>Homework</b> ${escapeHtml(formatNullable(assignmentTitle))}`,
    `<b>Created</b> ${escapeHtml(formatLocalizedDateTime(job.createdAt))}`,
    `<b>Finished</b> ${escapeHtml(formatLocalizedDateTime(job.finishedAt))}`,
    `<b>Preset</b> ${escapeHtml(formatNullable(job.learningPresetId ?? job.preset))}`,
    `<b>Error</b> ${escapeHtml(formatNullable(job.error))}`,
  ].join('\n');
}

export function formatShareJobHeader(
  job: JobStatusDto,
  options?: {
    assignmentTitle?: string | null;
  },
): string {
  const assignmentTitle = normalizeAssignmentTitle(options?.assignmentTitle);
  return [
    '<b>Share package</b>',
    `<b>Student</b> ${escapeHtml(formatStudentIdentity(job))}`,
    `<b>Job</b> <code>${escapeHtml(job.jobId)}</code>`,
    `<b>Created</b> ${escapeHtml(formatLocalizedDateTime(job.createdAt))}`,
    `<b>Finished</b> ${escapeHtml(formatLocalizedDateTime(job.finishedAt ?? job.updatedAt))}`,
    `<b>Homework</b> ${escapeHtml(formatNullable(assignmentTitle))}`,
    `<b>Preset</b> ${escapeHtml(formatNullable(job.learningPresetId ?? job.preset))}`,
  ].join('\n');
}

export function formatStudentNotFound(query: string): string {
  return [
    '<b>No student matched</b>',
    '',
    `No student matched <code>${escapeHtml(query)}</code>.`,
    'Try a full name, UUID, or UUID prefix.',
    'Examples: <code>/student Margarita</code> or <code>/student 72444fdf</code>',
  ].join('\n');
}

export function formatStudentDisambiguation(args: {
  query: string;
  matches: StudentProfileDto[];
  footer?: string;
}): string {
  const lines = args.matches.map(
    (student) =>
      `• <b>${escapeHtml(student.student)}</b> — <code>${escapeHtml(student.id.slice(0, 8))}</code>`,
  );
  return [
    '<b>Multiple students matched</b>',
    '',
    `Query: <code>${escapeHtml(args.query)}</code>`,
    ...lines,
    ...(args.footer ? ['', escapeHtml(args.footer)] : []),
  ].join('\n');
}

export function formatStudentSummary(args: {
  student: StudentProfileDto;
  latestJob: JobStatusDto | null;
  latestAssignmentTitle: string | null;
  recentJobs: JobStatusDto[];
}): string {
  const latest = args.latestJob;
  const recentJobsSection =
    args.recentJobs.length === 0
      ? 'No jobs yet.'
      : args.recentJobs
          .map(
            (job) =>
              `• ${escapeHtml(job.state)} · ${escapeHtml(formatJobTimestamp(job))} · ${escapeHtml(formatPreset(job))} · <code>${escapeHtml(job.jobId.slice(0, 12))}</code>`,
          )
          .join('\n');

  return [
    `<b>${escapeHtml(args.student.student)} (${escapeHtml(args.student.id.slice(0, 8))})</b>`,
    '',
    `<b>Latest state</b> ${escapeHtml(latest?.state ?? 'n/a')}`,
    `<b>Latest time</b> ${escapeHtml(latest ? formatJobTimestamp(latest) : 'n/a')}`,
    `<b>Latest homework</b> ${escapeHtml(formatNullable(args.latestAssignmentTitle))}`,
    '',
    '<b>Recent jobs</b>',
    recentJobsSection,
  ].join('\n');
}

export function formatJobsQueryResults(args: {
  response: JobListResponse;
  normalizedFilters: string[];
  title?: string;
  footerLines?: string[];
  emptyMessage?: string;
}): string {
  const title = args.title ?? 'Jobs';
  const footerLines = args.footerLines ?? [];
  const normalizedFilters = args.normalizedFilters.join(' ');
  if (args.response.jobs.length === 0) {
    return [
      `<b>${escapeHtml(title)}</b>`,
      '',
      `<b>Filters</b> ${escapeHtml(normalizedFilters)}`,
      escapeHtml(args.emptyMessage ?? 'No jobs matched.'),
      ...(footerLines.length > 0 ? ['', ...footerLines.map((line) => escapeHtml(line))] : []),
    ].join('\n');
  }

  return [
    `<b>${escapeHtml(title)}</b>`,
    '',
    `<b>Filters</b> ${escapeHtml(normalizedFilters)}`,
    `<b>Showing</b> ${args.response.jobs.length} of ${args.response.total}`,
    '',
    args.response.jobs.map((job) => formatJobListLine(job)).join('\n\n'),
    ...(footerLines.length > 0 ? ['', ...footerLines.map((line) => escapeHtml(line))] : []),
  ].join('\n');
}

export function formatTodaySummary(args: {
  dateLabel: string;
  summary: JobSummaryResponse;
  failedJobs: JobStatusDto[];
  runningJobs: JobStatusDto[];
  succeededJobs: JobStatusDto[];
}): string {
  const attentionLines: string[] = [];
  if ((args.summary.byState.failed ?? 0) > 0) {
    attentionLines.push(`• Failed: ${args.summary.byState.failed}`);
  }
  if ((args.summary.byState.running ?? 0) > 0) {
    attentionLines.push(`• Running: ${args.summary.byState.running}`);
  }
  if ((args.summary.byState.awaiting_approval ?? 0) > 0) {
    attentionLines.push(`• Awaiting approval: ${args.summary.byState.awaiting_approval}`);
  }

  return [
    `<b>Today · ${escapeHtml(args.dateLabel)} UTC</b>`,
    '',
    `<b>Total</b> ${args.summary.total}`,
    `<b>Succeeded</b> ${args.summary.byState.succeeded ?? 0}`,
    `<b>Failed</b> ${args.summary.byState.failed ?? 0}`,
    `<b>Running</b> ${args.summary.byState.running ?? 0}`,
    `<b>Queued</b> ${args.summary.byState.queued ?? 0}`,
    `<b>Awaiting approval</b> ${args.summary.byState.awaiting_approval ?? 0}`,
    ...(attentionLines.length > 0 ? ['', '<b>Attention</b>', ...attentionLines] : []),
    ...(args.succeededJobs.length > 0
      ? [
          '',
          '<b>Recent finished</b>',
          ...args.succeededJobs.map(
            (job) =>
              `• ${escapeHtml(formatStudentIdentity(job))} · ${escapeHtml(formatJobTimestamp(job))} · <code>${escapeHtml(job.jobId.slice(0, 12))}</code>`,
          ),
        ]
      : []),
    ...(args.failedJobs.length > 0
      ? [
          '',
          '<b>Recent failures</b>',
          ...args.failedJobs.map(
            (job) =>
              `• ${escapeHtml(formatStudentIdentity(job))} · ${escapeHtml(formatJobTimestamp(job))} · ${escapeHtml(formatNullable(job.error))}`,
          ),
        ]
      : []),
    ...(args.runningJobs.length > 0
      ? [
          '',
          '<b>Running now</b>',
          ...args.runningJobs.map(
            (job) =>
              `• ${escapeHtml(formatStudentIdentity(job))} · ${escapeHtml(formatJobTimestamp(job))} · <code>${escapeHtml(job.jobId.slice(0, 12))}</code>`,
          ),
        ]
      : []),
    '',
    '<b>Follow up</b>',
    '<code>/jobs state:failed since:today</code>',
    '<code>/jobs state:running</code>',
  ].join('\n');
}

export function formatBotStatusReport(args: {
  runtimeSnapshot: BotRuntimeSnapshot;
  config: BotConfig;
  backendReachable: boolean;
  backendError: string | null;
  topicStates: {
    domain: BotDomain;
    threadId?: number;
    routing: 'topic' | 'default' | 'unresolved';
  }[];
}): string {
  const healthy = args.runtimeSnapshot.initialized && args.backendReachable;
  const warnings: string[] = [];
  if (!args.runtimeSnapshot.initialized) {
    warnings.push('• Runtime not fully initialized');
  }
  if (!args.backendReachable) {
    warnings.push(`• Backend check failed: ${args.backendError ?? 'unknown error'}`);
  }
  for (const topic of args.topicStates) {
    if (topic.routing === 'default') {
      warnings.push(`• ${topic.domain} is using default thread routing`);
    }
    if (topic.routing === 'unresolved') {
      warnings.push(`• ${topic.domain} has no resolved topic/default thread`);
    }
  }

  const topicLines = args.topicStates.map((topic) => {
    const label =
      topic.routing === 'topic'
        ? `${topic.threadId}`
        : topic.routing === 'default'
          ? `${topic.threadId} (default)`
          : 'unresolved';
    return `• ${topic.domain}: ${escapeHtml(label)}`;
  });

  return [
    `<b>${healthy ? '✅' : '⚠️'} Bot status: ${healthy ? 'healthy' : 'degraded'}</b>`,
    '',
    '<b>Bot</b>',
    `• Username: ${escapeHtml(formatNullable(args.runtimeSnapshot.botUsername))}`,
    `• Mode: ${escapeHtml(args.runtimeSnapshot.mode)}`,
    `• Actions: ${escapeHtml(args.config.enableActionCommands ? 'enabled' : 'read-only')}`,
    '',
    `<b>${args.runtimeSnapshot.mode === 'polling' ? 'Polling' : 'Webhook'}</b>`,
    ...(args.runtimeSnapshot.mode === 'polling'
      ? [
          `• Poll interval: ${args.config.pollIntervalMs} ms`,
          `• Poll timeout: ${args.config.pollTimeoutSeconds} s`,
          `• Leader election: ${args.config.leaderElectionEnabled ? 'enabled' : 'disabled'}`,
          `• Leadership: ${escapeHtml(args.runtimeSnapshot.leadershipState)}`,
        ]
      : [
          `• Host: ${escapeHtml(args.config.webhookHost)}`,
          `• Port: ${args.config.webhookPort}`,
          `• Path: <code>${escapeHtml(args.config.webhookPath)}</code>`,
          `• Secret token: ${args.config.webhookSecretToken ? 'configured' : 'not configured'}`,
        ]),
    '',
    '<b>Backend</b>',
    `• Reachable: ${args.backendReachable ? 'yes' : 'no'}`,
    ...(args.backendError ? [`• Error: ${escapeHtml(args.backendError)}`] : []),
    '',
    '<b>Topics</b>',
    ...topicLines,
    ...(warnings.length > 0
      ? ['', '<b>Warnings</b>', ...warnings.map((line) => escapeHtml(line))]
      : []),
  ].join('\n');
}

export function formatStudentsBrowser(args: {
  response: StudentSummaryResponse;
  page: number;
}): string {
  if (args.response.items.length === 0) {
    return [`<b>Students · Page ${args.page}</b>`, '', 'No students found.'].join('\n');
  }

  return [
    `<b>Students · Page ${args.page}</b>`,
    '',
    `<b>Showing</b> ${args.response.items.length} of ${args.response.total}`,
    '',
    args.response.items.map((student) => formatStudentSummaryLine(student)).join('\n\n'),
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
  const assignmentUrl = job.htmlUrl ?? resolveAppJobUrl(job.jobId, appBaseUrl);
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
    resolveAudioUrlFromMarkdown(
      job.md,
      PRONUNCIATION_AUDIO_LINK_LABEL,
      PRONUNCIATION_AUDIO_PATH_HINTS,
    );

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
      lines.push(`• <a href="${escapeHtml(pronunciationAudioUrl)}">🗣️ Listen 2: Pronunciation</a>`);
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
  pathHints: string | readonly string[],
): string | null {
  if (!markdown) return null;

  const labelRegex = new RegExp(
    String.raw`\[${escapeRegExp(linkLabel)}\]\((https?:\/\/[^\s)]+)\)`,
    'i',
  );
  const labeledMatch = markdown.match(labelRegex);
  if (labeledMatch?.[1]) {
    return labeledMatch[1];
  }

  for (const pathHint of Array.isArray(pathHints) ? pathHints : [pathHints]) {
    const hintedRegex = new RegExp(
      String.raw`(https?:\/\/\S*${escapeRegExp(pathHint)}\S*\.mp3(?:\?\S*)?)`,
      'i',
    );
    const hintedMatch = markdown.match(hintedRegex);
    if (hintedMatch?.[1]) {
      return hintedMatch[1];
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function normalizeAssignmentTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replaceAll(/^homework\s+ass+i?ignment\s*:\s*/gi, '').trim() || null;
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
    status.state === 'succeeded'
      ? '✅'
      : status.state === 'failed'
        ? '❌'
        : status.state === 'running'
          ? '▶️'
          : '⏳';
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

export function formatRecentOpsActions(response: OpsActionListResponse): string {
  if (response.actions.length === 0) {
    return '<b>Recent operations</b>\n\nNo ops actions recorded yet.';
  }

  const lines = response.actions.map((action) => {
    const summary = action.message?.trim() || action.command;
    return `• <code>${escapeHtml(action.operationId)}</code> — ${escapeHtml(action.state)} (${escapeHtml(summary)})`;
  });

  return [
    '<b>Recent operations</b>',
    '',
    ...lines,
    '',
    `Showing ${response.actions.length} of ${response.total}.`,
  ].join('\n');
}

export function formatCommandError(message: string): string {
  return `<b>Command failed</b>\n\n${escapeHtml(message)}`;
}

export function formatGuidedActionConfirmation(args: {
  action: 'backup' | 'integrity';
  webhookMode: boolean;
}): string {
  if (args.action === 'backup') {
    return [
      '<b>Confirm backup upload</b>',
      '',
      'This runs the default unlabeled backup upload.',
      'Use <code>/backup &lt;label&gt;</code> if you need a custom label.',
      args.webhookMode
        ? 'Confirming here will generate the normal approval-token flow.'
        : 'Confirming here will queue the backup immediately.',
    ].join('\n');
  }

  return [
    '<b>Confirm artifact integrity check</b>',
    '',
    'This downloads the selected remote dump and verifies its matching checksum. It does not restore PostgreSQL.',
    args.webhookMode
      ? 'Confirming here will generate the normal approval-token flow.'
      : 'Confirming here will queue the integrity check immediately.',
  ].join('\n');
}

export function formatGuidedActionSubmitted(args: {
  action: 'backup' | 'integrity';
  webhookMode: boolean;
}): string {
  return [
    `<b>${args.action === 'backup' ? 'Backup' : 'Artifact integrity check'} request submitted</b>`,
    '',
    args.webhookMode
      ? 'The approval or execution result was posted as a new ops message. The confirm button here has been disabled.'
      : 'The queued result was posted as a new ops message. The confirm button here has been disabled.',
  ].join('\n');
}

export function formatStartMessage(args: {
  enableActionCommands: boolean;
  opsChatId: string;
  inOpsChat: boolean;
}): string {
  const modeLine = args.enableActionCommands
    ? 'This deployment currently allows the safe action commands that are enabled for ops.'
    : 'This deployment is currently running in read-only mode.';
  const locationLine = args.inOpsChat
    ? 'You are already in the configured ops chat for command execution.'
    : `Run operational commands in the configured ops chat: <code>${escapeHtml(args.opsChatId)}</code>.`;

  return [
    '<b>ESL Ops Control</b>',
    '',
    'This bot is the internal Telegram control surface for ESL Pipeline operations.',
    modeLine,
    'Use <code>/help</code> to see the onboarding commands available here.',
    locationLine,
  ].join('\n');
}

export function formatPrivateOnboardingRedirect(opsChatId: string): string {
  return [
    '<b>Use the ops chat for this command</b>',
    '',
    'Private chat is limited to onboarding in this phase.',
    `Use <code>/start</code> or <code>/help</code> here, then switch to the configured ops chat: <code>${escapeHtml(opsChatId)}</code>.`,
  ].join('\n');
}
