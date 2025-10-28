export type Frontmatter = {
  title: string;
  student: string;
  level: string;
  topic: string | string[];
  input_type: string;
  speaker_labels?: string[];
  speaker_profiles?: SpeakerProfile[];
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

export type SpeakerProfile = {
  id: string;
  display_name?: string;
  role?: 'narrator' | 'teacher' | 'student' | 'system';
  gender?: 'male' | 'female' | 'neutral' | 'child';
  age?: 'child' | 'teen' | 'young' | 'adult' | 'middle_aged' | 'senior' | 'universal';
  accent?: string;
  style?: string;
  voice?: string;
  [k: string]: unknown;
};
