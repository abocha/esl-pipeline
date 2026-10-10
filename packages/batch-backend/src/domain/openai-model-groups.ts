// Explicit DSI membership: never infer a group from a model-name prefix.
// Source: OpenAI sharing-data FAQ, verified 2026-10-10. New models require review.
export const OPENAI_MODEL_GROUPS = {
  efficient: [
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.4-mini-2026-03-17',
    'gpt-5.4-nano-2026-03-17',
    'gpt-5.1-codex-mini',
    'gpt-5-mini',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano',
    'gpt-5-nano-2025-08-07',
    'gpt-4.1-mini',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-nano',
    'gpt-4.1-nano-2025-04-14',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'o4-mini',
    'o4-mini-2025-04-16',
    'o1-mini',
    'o1-mini-2024-09-12',
    'codex-mini-latest',
  ],
  larger: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5.5-2026-04-23',
    'gpt-5.4-2026-03-05',
    'gpt-5.2-2025-12-11',
    'gpt-5.1-2025-11-13',
    'gpt-5.1-codex',
    'gpt-5-codex',
    'gpt-5',
    'gpt-5-2025-08-07',
    'gpt-5-chat-latest',
    'gpt-4.1',
    'gpt-4.1-2025-04-14',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20',
    'o3',
    'o3-2025-04-16',
    'o1-preview',
    'o1-preview-2024-09-12',
    'o1',
    'o1-2024-12-17',
  ],
} as const;

export type OpenAiModelGroup = keyof typeof OPENAI_MODEL_GROUPS;

export function getOpenAiModelGroup(model: string): OpenAiModelGroup {
  for (const group of ['efficient', 'larger'] as const) {
    if ((OPENAI_MODEL_GROUPS[group] as readonly string[]).includes(model)) return group;
  }
  throw new Error('OpenAI model has no reviewed daily-budget group. Select a classified model.');
}
