import type {
  MarkdownValidationIssue,
  MarkdownValidationIssueCategory,
  MarkdownValidationResponse,
} from '@esl-pipeline/contracts';

import { type GeneralEnglishValidateInput, validateGeneralEnglishRuleset } from './v1.js';

interface DiagnosticPolicy {
  code: string;
  ruleId: string;
  severity: MarkdownValidationIssue['severity'];
  category: MarkdownValidationIssueCategory;
  blockingInStrict: boolean;
  matches: RegExp;
}

const DIAGNOSTIC_POLICIES: readonly DiagnosticPolicy[] = [
  policy(
    'voice.speaker_profile_role_recommendation',
    'frontmatter',
    'voice',
    false,
    /^front matter: speaker_profiles role /i,
  ),
  policy(
    'voice.frontmatter_alignment',
    'frontmatter',
    'voice',
    true,
    /^front matter: (?:input_type .* legacy|study_text_type|speaker_labels contains duplicates|speaker_profiles contains duplicate ids|speaker_labels are set|speaker_profiles are set|speaker label .* has no matching|speaker_profiles id .* is not present|speaker_profiles (?:style|voice|accent)|unable to verify speaker_profiles\.voice|unsupported (?:accent|style))/i,
  ),
  errorPolicy('frontmatter.invalid', 'frontmatter', 'contract', true, /^front matter:/i),
  policy('structure.h2_count', 'h2-order', 'contract', true, /^expected at least \d+ h2 sections/i),
  policy('structure.h2_mismatch', 'h2-order', 'contract', true, /^h2 #\d+ mismatch/i),
  policy(
    'structure.additional_h2_ignored',
    'h2-order',
    'quality',
    false,
    /^additional h2 sections after section 8/i,
  ),
  policy('marker.required_missing', 'required-markers', 'contract', true, /^missing marker:/i),
  errorPolicy('study_text.missing', 'study-text', 'runtime', true, /^missing ":::study-text/i),
  errorPolicy(
    'study_text.marker_invalid',
    'study-text',
    'runtime',
    true,
    /^line \d+: (study-text marker|malformed study-text marker)/i,
  ),
  policy(
    'study_text.closing_marker_layout',
    'study-text',
    'runtime',
    false,
    /^line \d+: study-text closing marker/i,
  ),
  errorPolicy(
    'study_text.closing_marker_missing',
    'study-text',
    'runtime',
    true,
    /^study-text block starting at line \d+ is missing a closing/i,
  ),
  policy('study_text.speaker_alignment', 'study-text', 'runtime', true, /^study-text line \d+:/i),
  policy(
    'study_text.length_recommendation',
    'study-text',
    'quality',
    true,
    /^study-text looks short/i,
  ),
  policy(
    'practice.controlled_section_missing',
    'controlled-practice',
    'contract',
    true,
    /^no "### a\. controlled practice"/i,
  ),
  policy(
    'practice.controlled_count_recommendation',
    'controlled-practice',
    'quality',
    false,
    /^controlled practice has /i,
  ),
  policy(
    'practice.comprehension_section_missing',
    'comprehension-check',
    'contract',
    true,
    /^no "### comprehension check"/i,
  ),
  policy(
    'practice.comprehension_count_recommendation',
    'comprehension-check',
    'quality',
    false,
    /^comprehension check has /i,
  ),
  policy(
    'pronunciation.section_missing',
    'pronunciation-micro-focus',
    'quality',
    false,
    /^missing "### b\. pronunciation micro-focus"/i,
  ),
  policy(
    'pronunciation.contract_recommendation',
    'pronunciation-micro-focus',
    'quality',
    false,
    /^pronunciation micro-focus/i,
  ),
  policy(
    'pronunciation.line_recommendation',
    'pronunciation-micro-focus',
    'quality',
    false,
    /^line \d+: .*?(transcription|shadow sentence|natural sentence|pronunciation)/i,
  ),
  policy('markdown.code_block_forbidden', 'code-block', 'runtime', true, /^found code block/i),
  policy('directive.callout_invalid', 'callout', 'runtime', true, /^callout starting at line/i),
  policy(
    'directive.column_list_invalid',
    'column-list',
    'runtime',
    true,
    /^(hint: found indented ":::column"|column-list starting at line)/i,
  ),
  policy(
    'directive.synced_block_invalid',
    'synced-block',
    'runtime',
    true,
    /^synced-block starting at line/i,
  ),
  policy(
    'media.directive_missing_url',
    'media-directive',
    'runtime',
    true,
    /^line \d+: (audio|video) directive requires a url/i,
  ),
  policy('table.invalid_structure', 'table-structure', 'quality', true, /^table starting at line/i),
];

export async function validateGeneralEnglishV2Ruleset(
  input: GeneralEnglishValidateInput,
): Promise<MarkdownValidationResponse> {
  const baseline = await validateGeneralEnglishRuleset(
    { ...input, strict: false },
    { version: 'current' },
  );
  const issues = sortIssues([
    ...baseline.errors.map((message) => toIssue(message, 'error')),
    ...baseline.warnings.map((message) => toIssue(message, 'warning')),
  ]);
  const strictErrors = input.strict
    ? issues
        .filter((issue) => issue.severity === 'warning' && issue.blockingInStrict)
        .map((issue) => issue.message)
    : [];
  const errors = unique([...baseline.errors, ...strictErrors]);

  return {
    ...baseline,
    ok: errors.length === 0,
    errors,
    issues,
  };
}

function policy(
  code: string,
  ruleId: string,
  category: MarkdownValidationIssueCategory,
  blockingInStrict: boolean,
  matches: DiagnosticPolicy['matches'],
): DiagnosticPolicy {
  return { code, ruleId, severity: 'warning', category, blockingInStrict, matches };
}

function errorPolicy(
  code: string,
  ruleId: string,
  category: MarkdownValidationIssueCategory,
  blockingInStrict: boolean,
  matches: DiagnosticPolicy['matches'],
): DiagnosticPolicy {
  return { ...policy(code, ruleId, category, blockingInStrict, matches), severity: 'error' };
}

function toIssue(
  message: string,
  observedSeverity: MarkdownValidationIssue['severity'],
): MarkdownValidationIssue {
  return classifyGeneralEnglishV2Diagnostic(message, observedSeverity);
}

export function classifyGeneralEnglishV2Diagnostic(
  message: string,
  observedSeverity: MarkdownValidationIssue['severity'],
): MarkdownValidationIssue {
  const diagnosticPolicy = DIAGNOSTIC_POLICIES.find((candidate) => candidate.matches.test(message));
  return {
    code: diagnosticPolicy?.code ?? 'general_english_v2.unclassified_diagnostic',
    ruleId: diagnosticPolicy?.ruleId ?? 'general-english-v2-classification',
    severity: diagnosticPolicy?.severity ?? observedSeverity,
    message,
    ...(findLine(message) !== undefined ? { line: findLine(message) } : {}),
    category: diagnosticPolicy?.category ?? 'contract',
    blockingInStrict:
      (diagnosticPolicy?.severity ?? observedSeverity) === 'error' ||
      (diagnosticPolicy?.blockingInStrict ?? true),
  };
}

function findLine(message: string): number | undefined {
  const match = /(?:^|\s)line\s+(\d+)/i.exec(message);
  return match?.[1] ? Number(match[1]) : undefined;
}

function sortIssues(issues: MarkdownValidationIssue[]): MarkdownValidationIssue[] {
  return [...issues].sort((left, right) => {
    const leftLine = left.line ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.line ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    if (left.ruleId !== right.ruleId) return left.ruleId.localeCompare(right.ruleId);
    return left.message.localeCompare(right.message);
  });
}

function unique(messages: string[]): string[] {
  return [...new Set(messages)];
}
