import type {
  MarkdownValidationIssue,
  MarkdownValidationIssueCategory,
  MarkdownValidationIssueSeverity,
  MarkdownValidationResponse,
  MarkdownValidationRuleSetInfo,
} from '@esl-pipeline/contracts';

function inferIssueLine(message: string): number | undefined {
  const explicitLine = /(?:^|\s)line\s+(\d+)/i.exec(message);
  if (explicitLine?.[1]) {
    const parsed = Number(explicitLine[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const prefixed = /^Line\s+(\d+):/i.exec(message);
  if (prefixed?.[1]) {
    const parsed = Number(prefixed[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function issueCodeFromMessage(message: string, fallback: string): string {
  const normalized = message
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  if (!normalized) return fallback;
  return normalized.slice(0, 80);
}

function inferCategory(message: string): MarkdownValidationIssueCategory {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('front matter: speaker_')) return 'voice';
  if (normalized.includes('study_text_type')) return 'voice';
  if (normalized.includes('voice catalog')) return 'voice';
  if (normalized.includes('unsupported accent') || normalized.includes('unsupported style')) {
    return 'voice';
  }
  if (
    normalized.includes('study-text') ||
    normalized.includes('pronunciation micro-focus') ||
    normalized.includes('shadow sentence')
  ) {
    return 'runtime';
  }
  if (
    normalized.startsWith('controlled practice has') ||
    normalized.startsWith('comprehension check has') ||
    normalized.startsWith('additional h2 sections after section 9') ||
    normalized.startsWith('front matter: speaker_profiles role')
  ) {
    return 'quality';
  }
  if (normalized.startsWith('h2 #') || normalized.startsWith('missing marker:')) {
    return 'contract';
  }
  if (normalized.startsWith('table starting at line') || normalized.includes('column-list')) {
    return 'quality';
  }
  return 'contract';
}

function inferBlockingInStrict(
  message: string,
  severity: MarkdownValidationIssueSeverity,
): boolean {
  if (severity === 'error') return true;

  const normalized = message.toLowerCase();
  if (normalized.startsWith('controlled practice has ')) return false;
  if (normalized.startsWith('comprehension check has ')) return false;
  if (normalized.startsWith('missing "### <letter>. pronunciation micro-focus" section under h2 #5.')) {
    return false;
  }
  if (normalized.startsWith('pronunciation micro-focus')) return false;
  if (
    normalized.startsWith('line ') &&
    normalized.includes('must be wrapped in forward slashes')
  ) {
    return false;
  }
  if (normalized.startsWith('additional h2 sections after section 9')) return false;
  if (normalized.startsWith('front matter: speaker_profiles role "')) return false;
  return true;
}

function inferRuleId(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('front matter:')) return 'frontmatter';
  if (normalized.includes('study-text')) return 'study-text';
  if (normalized.startsWith('h2 #')) return 'h2-order';
  if (normalized.startsWith('missing marker:')) return 'required-markers';
  if (normalized.includes('controlled practice')) return 'controlled-practice';
  if (normalized.includes('comprehension check')) return 'comprehension-check';
  if (normalized.includes('pronunciation micro-focus')) return 'pronunciation-micro-focus';
  if (normalized.includes('column-list')) return 'column-list';
  if (normalized.includes('synced-block')) return 'synced-block';
  if (normalized.startsWith('table ')) return 'table-structure';
  return 'legacy-validator';
}

export function buildIssuesFromLegacyMessages(input: {
  errors: string[];
  warnings: string[];
}): MarkdownValidationIssue[] {
  const issuesByMessage = new Map<string, MarkdownValidationIssue>();

  const append = (message: string, severity: MarkdownValidationIssueSeverity) => {
    const existing = issuesByMessage.get(message);
    if (existing) {
      if (existing.severity !== 'error' && severity === 'error') {
        existing.severity = 'error';
        existing.blockingInStrict = true;
      }
      return;
    }

    const category = inferCategory(message);
    const issue: MarkdownValidationIssue = {
      code: issueCodeFromMessage(
        message,
        severity === 'error' ? 'validation_error' : 'validation_warning',
      ),
      ruleId: inferRuleId(message),
      severity,
      message,
      line: inferIssueLine(message),
      category,
      blockingInStrict: inferBlockingInStrict(message, severity),
    };
    issuesByMessage.set(message, issue);
  };

  for (const error of input.errors) append(error, 'error');
  for (const warning of input.warnings) append(warning, 'warning');

  return [...issuesByMessage.values()].sort((left, right) => {
    const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    if (left.ruleId !== right.ruleId) return left.ruleId.localeCompare(right.ruleId);
    return left.message.localeCompare(right.message);
  });
}

export function mergeIssues(
  baseIssues: MarkdownValidationIssue[],
  extraIssues: MarkdownValidationIssue[],
): MarkdownValidationIssue[] {
  const map = new Map<string, MarkdownValidationIssue>();
  for (const issue of [...baseIssues, ...extraIssues]) {
    const key = `${issue.ruleId}::${issue.message}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, issue);
      continue;
    }
    if (existing.severity !== 'error' && issue.severity === 'error') {
      map.set(key, issue);
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    if (left.ruleId !== right.ruleId) return left.ruleId.localeCompare(right.ruleId);
    return left.message.localeCompare(right.message);
  });
}

export function appendResolutionIssuesToLegacyPayload(input: {
  errors: string[];
  warnings: string[];
  resolutionIssues: MarkdownValidationIssue[];
}): { errors: string[]; warnings: string[] } {
  const errors = [...input.errors];
  const warnings = [...input.warnings];

  for (const issue of input.resolutionIssues) {
    if (issue.severity === 'error') {
      if (!errors.includes(issue.message)) errors.push(issue.message);
      continue;
    }
    if (!warnings.includes(issue.message)) warnings.push(issue.message);
  }

  return { errors, warnings };
}

export function withRulesetMetadata(
  response: MarkdownValidationResponse,
  ruleset: MarkdownValidationRuleSetInfo,
  issues: MarkdownValidationIssue[],
): MarkdownValidationResponse {
  return {
    ...response,
    issues,
    ruleset,
  };
}
