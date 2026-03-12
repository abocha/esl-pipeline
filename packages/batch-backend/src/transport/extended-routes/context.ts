import type { SttProviderId } from '@esl-pipeline/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BatchBackendConfig } from '../../config/env.js';
import type { AuthService } from '../../infrastructure/auth-service.js';
import type { FileSanitizationService } from '../../infrastructure/file-sanitization-service.js';
import type { FileStorageService } from '../../infrastructure/file-storage-service.js';
import type { FileValidationService } from '../../infrastructure/file-validation-service.js';
import type { StorageConfigurationService } from '../../infrastructure/storage-config.js';
import type { TranscriptionStorage } from '../../infrastructure/transcription-storage.js';

export type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface ExtendedRouteOptions {
  config: BatchBackendConfig;
  authService: AuthService;
  authenticate: AsyncPreHandler;
  uploadRateLimitMiddleware: AsyncPreHandler;
  fileValidationService: FileValidationService | null;
  recordingUploadValidationService: FileValidationService | null;
  fileSanitizationService: FileSanitizationService | null;
  storageConfig: StorageConfigurationService;
  fileStorageService: FileStorageService;
}

export interface TranscribeQueueFacade {
  enqueue(payload: { recordingId: string; sttProvider?: SttProviderId }): Promise<void>;
}

export interface ExtendedRoutesContext extends ExtendedRouteOptions {
  transcriptionStorage: TranscriptionStorage;
  transcribeQueue: TranscribeQueueFacade;
}
