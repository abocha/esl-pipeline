// packages/batch-backend/src/application/get-job-options.ts
//
// Temporary job-options provider for the batch frontend. The intent is to swap
// this out for a config-backed implementation once the orchestrator exposes its
// preset/voice metadata over HTTP.

export type UploadOption = 'auto' | 's3' | 'none';
export type JobModeOption = 'auto' | 'dialogue' | 'monologue';

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

export interface JobOptionsResponse {
  presets: string[];
  voiceAccents: string[];
  notionDatabases: NotionDatabaseOption[];
  uploadOptions: UploadOption[];
  modes: JobModeOption[];
}

// TODO: Replace these with data pulled from the orchestrator config provider or
// dedicated metadata service once available (tracked in backend/frontend Phase 5).
const STATIC_OPTIONS: JobOptionsResponse = {
  presets: ['b1-default'],
  voiceAccents: ['american_female', 'british_male'],
  notionDatabases: [
    { id: 'notion-db-b1', name: 'B1 Lessons' },
    { id: 'notion-db-b2', name: 'B2 Lessons' },
  ],
  uploadOptions: ['auto', 's3', 'none'],
  modes: ['auto'],
};

export async function getJobOptions(): Promise<JobOptionsResponse> {
  return {
    presets: [...STATIC_OPTIONS.presets],
    voiceAccents: [...STATIC_OPTIONS.voiceAccents],
    notionDatabases: STATIC_OPTIONS.notionDatabases.map(db => ({ ...db })),
    uploadOptions: [...STATIC_OPTIONS.uploadOptions],
    modes: [...STATIC_OPTIONS.modes],
  };
}
