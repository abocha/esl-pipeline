/** Public MCP projection. Versioned independently of internal teaching_context.v1. */
export const MCP_TEACHING_CONTEXT_VERSION = 'mcp_teaching_context.v1' as const;

export interface FindStudentResultDto {
  status: 'none' | 'single' | 'ambiguous';
  candidates: Array<{ studentId: string; name: string }>;
  hasMore: boolean;
}

export interface McpTeachingNoteDto {
  label: string;
  note: string;
}

export interface McpTeachingContextDto {
  contractVersion: typeof MCP_TEACHING_CONTEXT_VERSION;
  student: { studentId: string; name: string };
  profile: {
    level: string | null;
    goals: string[];
    communicationContexts: string[];
    usefulThemes: string[];
    strengths: string[];
    challenges: string[];
    studyPreferences: string[];
  } | null;
  memory: {
    strengths: McpTeachingNoteDto[];
    recurringIssues: McpTeachingNoteDto[];
    reviewBacklog: McpTeachingNoteDto[];
    recentProgress: McpTeachingNoteDto[];
    unresolvedIssues: McpTeachingNoteDto[];
  } | null;
  recentLessons: Array<{
    generatedAt: string;
    title: string | null;
    summary: string | null;
    topics: McpTeachingNoteDto[];
    mistakes: McpTeachingNoteDto[];
    grammar: McpTeachingNoteDto[];
    vocabulary: McpTeachingNoteDto[];
    pronunciation: McpTeachingNoteDto[];
    followUp: McpTeachingNoteDto[];
  }>;
  recentHomework: Array<{
    publishedAt: string;
    summary: string | null;
    topic: string | null;
    grammar: McpTeachingNoteDto[];
    vocabulary: McpTeachingNoteDto[];
    review: McpTeachingNoteDto[];
    outcome: string | null;
    followUp: McpTeachingNoteDto[];
  }>;
}

export interface GetStudentTeachingContextResultDto {
  context: McpTeachingContextDto;
  availability: import('./student-memory-availability.js').StudentMemoryAvailability;
}
