import type { FastifyInstance } from 'fastify';

import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { registerAuthUserRoutes } from './extended-routes/auth-user-routes.js';
import { registerBusinessRoutes } from './extended-routes/business-routes.js';
import { registerCalendarSchedulingRoutes } from './extended-routes/calendar-routes.js';
import { registerConfigRoutes } from './extended-routes/config-routes.js';
import { registerGoogleCalendarConnectionRoutes } from './extended-routes/google-calendar-connection-routes.js';
import { registerOpsRoutes } from './extended-routes/ops-routes.js';
import { registerRecordingRoutes } from './extended-routes/recordings-routes.js';
import { registerStudentRoutes } from './extended-routes/students-routes.js';
import { registerTemplateRoutes } from './extended-routes/templates-routes.js';

export type { ExtendedRouteOptions } from './extended-routes/context.js';
export { inferTranscriptSttProvider } from './extended-routes/recording-provider-cache.js';

export function registerExtendedRoutes(
  app: FastifyInstance,
  options: import('./extended-routes/context.js').ExtendedRouteOptions,
): void {
  const transcriptionStorage = createTranscriptionStorage({ storageConfig: options.storageConfig });
  const transcribeQueue = createTranscribeQueue();
  const context = {
    ...options,
    transcriptionStorage,
    transcribeQueue,
  };

  registerConfigRoutes(app, context);
  registerCalendarSchedulingRoutes(app, context);
  registerStudentRoutes(app, context);
  registerBusinessRoutes(app, context);
  registerTemplateRoutes(app, context);
  registerRecordingRoutes(app, context);
  registerAuthUserRoutes(app, context);
  registerGoogleCalendarConnectionRoutes(app, context);
  registerOpsRoutes(app, context);
}
