import { z } from 'zod';

/** Calendar scheduling v1: provider owns recurrence after creation. */
export const calendarSlotSchema = z
  .object({
    kind: z.enum(['one_off', 'weekly']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    localTime: z.string().regex(/^\d{2}:\d{2}$/),
    weekday: z.number().int().min(0).max(6).optional(),
    durationMinutes: z.number().int().min(1).max(1440),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .superRefine((slot, ctx) => {
    if (slot.kind === 'weekly' && slot.weekday === undefined)
      ctx.addIssue({ code: 'custom', message: 'Weekly slots require a weekday' });
    if (slot.endDate && (slot.kind !== 'weekly' || slot.endDate < slot.startDate))
      ctx.addIssue({ code: 'custom', message: 'Invalid series end date' });
  });
export const calendarSetupRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    timezone: z.string().min(1).max(100),
    sendInvitation: z.boolean().optional(),
    slots: z.array(calendarSlotSchema).min(1).max(20),
  })
  .strict();
export type CalendarSlotDto = z.infer<typeof calendarSlotSchema>;
export type CalendarSetupRequestDto = z.infer<typeof calendarSetupRequestSchema>;
export type CalendarOperationState =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | 'succeeded'
  | 'needs_review'
  | 'superseded';
export interface CalendarOperationDto {
  id: string;
  parentId: string | null;
  kind: 'setup' | 'create' | 'bind' | 'sync' | 'refresh';
  state: CalendarOperationState;
  errorCode: string | null;
  slotIndex: number | null;
  eventUrl: string | null;
}
export interface CalendarSetupDto {
  id: string;
  operations: CalendarOperationDto[];
}
export interface CalendarSchedulingStatusDto {
  state: 'disconnected' | 'reconnect_required' | 'syncing' | 'synced' | 'needs_attention';
  connectionId: string | null;
  calendarName: string | null;
  googleEmail: string | null;
  lastSyncedAt: string | null;
  errorCode: string | null;
  operations: CalendarOperationDto[];
}
export interface CalendarUnlinkedEventDto {
  id: string;
  title: string;
  startsAt: string | null;
  recurring: boolean;
  eventUrl: string | null;
}
export interface CalendarUnlinkedEventsPageDto {
  events: CalendarUnlinkedEventDto[];
  nextPageToken: string | null;
}
export interface CalendarLessonLinkDto {
  eventUrl: string | null;
  state: 'linked' | 'needs_attention';
  errorCode: string | null;
}
/** Restricted owner/admin review, separate from ordinary operation/status responses. */
export interface CalendarOperationReviewDto {
  id: string;
  requestHash: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  recurrence: string[];
  invitationRecipient: string | null;
}
