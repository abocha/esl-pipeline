export type {
  Frontmatter,
  PmdBlock,
  PmdBlockQuote,
  PmdCodeBlock,
  PmdDirectiveBlock,
  PmdDirectiveLeaf,
  PmdDocument,
  PmdHeading,
  PmdList,
  PmdListItem,
  PmdParagraph,
  PmdPoint,
  PmdPosition,
  PmdTable,
  PmdThematicBreak,
  PmdUnknown,
  PmdWarning,
  Section,
  SpeakerProfile,
  StudyText,
} from './types.js';

export type { ParseOptions } from './parser.js';
export { parsePmdDocument, parsePmdFromFile } from './parser.js';
export type { MarkdownSourceFormat, NormalizedMarkdownSource } from './source.js';
export { normalizeMarkdownSource } from './source.js';
export { findDirectiveBlocks } from './query.js';
export {
  extractAnswerKey,
  extractFrontmatter,
  extractSections,
  extractStudyText,
  extractTeacherNotes,
} from './extract.js';
