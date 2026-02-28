export interface PmdPoint {
  line: number;
  column: number;
  offset?: number;
}

export interface PmdPosition {
  start: PmdPoint;
  end: PmdPoint;
}

export interface PmdWarning {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface PmdDocument {
  type: 'document';
  frontmatter: Record<string, unknown>;
  body: PmdBlock[];
  warnings: PmdWarning[];
  meta: {
    format: 'canonical' | 'legacy-fenced';
  };
}

export interface PmdNode {
  type: string;
  position?: PmdPosition;
}

export interface PmdHeading extends PmdNode {
  type: 'heading';
  depth: number;
  text: string;
}

export interface PmdParagraph extends PmdNode {
  type: 'paragraph';
  text: string;
}

export interface PmdList extends PmdNode {
  type: 'list';
  ordered: boolean;
  start?: number;
  items: PmdListItem[];
}

export interface PmdListItem extends PmdNode {
  type: 'list_item';
  checked?: boolean | null;
  children: PmdBlock[];
}

export interface PmdCodeBlock extends PmdNode {
  type: 'code_block';
  lang?: string | null;
  value: string;
}

export interface PmdBlockQuote extends PmdNode {
  type: 'blockquote';
  children: PmdBlock[];
}

export interface PmdThematicBreak extends PmdNode {
  type: 'thematic_break';
}

export interface PmdTable extends PmdNode {
  type: 'table';
  align?: ('left' | 'center' | 'right' | null)[];
  rows: string[][];
}

export interface PmdDirectiveBlock extends PmdNode {
  type: 'directive_block';
  name: string;
  label?: string;
  attributes?: Record<string, string | number | boolean>;
  children: PmdBlock[];
}

export interface PmdDirectiveLeaf extends PmdNode {
  type: 'directive_leaf';
  name: string;
  label?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface PmdUnknown extends PmdNode {
  type: 'unknown';
  originalType: string;
  value?: string;
}

export type PmdBlock =
  | PmdHeading
  | PmdParagraph
  | PmdList
  | PmdListItem
  | PmdCodeBlock
  | PmdBlockQuote
  | PmdThematicBreak
  | PmdTable
  | PmdDirectiveBlock
  | PmdDirectiveLeaf
  | PmdUnknown;

export interface Frontmatter {
  title: string;
  student: string;
  level: string;
  topic: string | string[];
  input_type: import('@esl-pipeline/contracts').ContentSource;
  study_text_type?: import('@esl-pipeline/contracts').StudyTextType;
  speaker_labels?: string[];
  speaker_profiles?: import('@esl-pipeline/contracts').SpeakerProfile[];
  // allow arbitrary extras without breaking
  [k: string]: unknown;
}

export type StudyText =
  | { type: 'dialogue'; lines: string[] }
  | { type: 'monologue'; lines: string[] };

export interface Section {
  depth: 2 | 3;
  title: string;
  content: string;
}

export interface PronunciationShadowWord {
  text: string;
  transcription: string;
  line: number;
}

export interface PronunciationShadowIssue {
  code: string;
  message: string;
  line: number;
}

export interface PronunciationShadowFocus {
  mode: 'shadow_sentence';
  shadowSentence?: string;
  words: PronunciationShadowWord[];
  sectionStartLine: number;
  issues: PronunciationShadowIssue[];
}

export interface ParsedMarkdownContext {
  rawMarkdown: string;
  normalized: import('./source.js').NormalizedMarkdownSource;
  document: PmdDocument;
  content: string;
  contentLines: string[];
  rawLines: string[];
  contentLineOffset: number;
}

export type { ContentSource, SpeakerProfile, StudyTextType } from '@esl-pipeline/contracts';
