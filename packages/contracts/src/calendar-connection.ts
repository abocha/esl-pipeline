import { z } from 'zod';

export const CalendarConnectionDtoSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  calendarId: z.string(),
  calendarName: z.string(),
  calendarTimezone: z.string(),
  googleEmail: z.string(),
  generation: z.number().int(),
  status: z.enum(['connected', 'reconnect_required', 'disconnected']),
  lastSyncedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type CalendarConnectionDto = z.infer<typeof CalendarConnectionDtoSchema>;
export const CalendarConnectionStatusDtoSchema = z.object({
  enabled: z.boolean(),
  canManage: z.boolean(),
  canSchedule: z.boolean(),
  unavailableReason: z.string().nullable(),
  connection: CalendarConnectionDtoSchema.nullable(),
  grant: z.object({ id: z.string().uuid(), googleEmail: z.string() }).nullable(),
});
export type CalendarConnectionStatusDto = z.infer<typeof CalendarConnectionStatusDtoSchema>;
export const CalendarSelectionDtoSchema = z.object({
  id: z.string(),
  summary: z.string(),
  timeZone: z.string(),
  accessRole: z.enum(['writer', 'owner']),
});
export type CalendarSelectionDto = z.infer<typeof CalendarSelectionDtoSchema>;
export const CalendarSelectRequestSchema = z
  .object({
    calendarId: z.string().min(1).max(1024),
    confirmReplacement: z.boolean().default(false),
  })
  .strict();
