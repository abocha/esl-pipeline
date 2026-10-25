import { z } from 'zod';

/** OpenAI's authenticated connection profile; independent of learner profiles. */
export const mcpProfileSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/\S/)
      .describe(
        'Opaque profile identifier, unique within this app and unchanged across token refresh, reconnection, and display-metadata changes. Never reassigned to another profile.',
      ),
    name: z.string().describe('Display name for the authenticated profile.').optional(),
    email: z
      .string()
      .describe('Email address for display; not used as the profile identity.')
      .optional(),
    nickname: z
      .string()
      .describe('A useful label that helps users distinguish connected profiles.')
      .optional(),
  })
  .strict();

export type McpProfileDto = z.infer<typeof mcpProfileSchema>;
