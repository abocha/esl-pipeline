export type Frontmatter = {
  title: string;
  student: string;
  level: string;
  topic: string | string[];
  input_type: string;
  speaker_labels?: string[];
  // allow arbitrary extras without breaking
  [k: string]: unknown;
};

export type StudyText =
  | { type: 'dialogue'; lines: string[] }
  | { type: 'monologue'; lines: string[] };

export type Section = {
  depth: 2 | 3;
  title: string;
  content: string;
};
