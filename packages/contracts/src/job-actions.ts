// packages/contracts/src/job-actions.ts
//
// Shared types for job actions between backend and frontend
import type {
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  JobConfigOverrides,
  PronunciationChunkTtsProviderId,
  TtsProviderId,
  TtsStrategy,
} from './index.js';

/**
 * Supported job action types
 */
export enum JobActionType {
  RERUN = 'rerun',
  CANCEL = 'cancel',
  EDIT_METADATA = 'edit_metadata',
}

export interface RerunJobPayload {
  republishOnly?: boolean;
  regenerateStudyTextAudio?: boolean;
  regeneratePronunciationMainAudio?: boolean;
  regeneratePronunciationChunkAudio?: boolean;
  studyTextTtsProvider?: TtsProviderId;
  studyTextElevenlabsModel?: ElevenLabsTtsModelId;
  studyTextGoogleTtsModel?: GoogleTtsModel;
  studyTextVoiceId?: string;
  studyTextVoiceAccent?: string;
  studyTextTtsStrategy?: TtsStrategy;
  studyTextDialogueLanguage?: string;
  studyTextDialogueStability?: number;
  studyTextDialogueSeed?: number;
  pronunciationMainTtsProvider?: TtsProviderId;
  pronunciationMainElevenlabsModel?: ElevenLabsTtsModelId;
  pronunciationMainGoogleTtsModel?: GoogleTtsModel;
  pronunciationMainVoiceId?: string;
  pronunciationMainVoiceAccent?: string;
  pronunciationChunkTtsProvider?: PronunciationChunkTtsProviderId;
  pronunciationChunkElevenlabsModel?: ElevenLabsTtsModelId;
  pronunciationChunkGoogleTtsModel?: GoogleTtsModel;
  pronunciationChunkVoiceId?: string;
  pronunciationChunkVoiceAccent?: string;
  pronunciationChunkEdgeVoice?: string;
}

export type EditMetadataJobPayload = Omit<
  JobConfigOverrides,
  'studyTextElevenlabsModel' | 'googleTtsModel'
> & {
  studyTextElevenlabsModel?: ElevenLabsTtsModelId | null;
  googleTtsModel?: GoogleTtsModel | null;
};

/**
 * Request to execute a job action
 */
export type JobActionRequest =
  | {
      type: JobActionType.RERUN;
      payload?: RerunJobPayload;
    }
  | {
      type: JobActionType.CANCEL;
      payload?: {
        reason?: string;
      };
    }
  | {
      type: JobActionType.EDIT_METADATA;
      payload?: EditMetadataJobPayload;
    };

/**
 * Response from executing a job action
 */
export interface JobActionResponse {
  success: boolean;
  message: string;
  jobId: string;
  actionType: JobActionType;
  timestamp: string;
  error?: string;
}

/**
 * Action capability metadata
 * Informs frontend which actions are available
 */
export interface ActionCapability {
  type: string;
  label: string;
  description: string;
  implemented: boolean;
  requiresFields?: string[];
}
