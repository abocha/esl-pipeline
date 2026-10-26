import { z } from 'zod';

// Bounds admission before the ordinary whole-envelope generation budget check.
export const ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH = 60_000;

export const AssignmentMaterialSchema = z
  .object({
    mode: z.enum(['generated', 'authentic']),
    sourceUrl: z.string().max(2048),
    sourceText: z.string().max(ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH),
    sourceTextUrl: z.string().max(2048),
  })
  .strict();

export type AssignmentMaterial = z.infer<typeof AssignmentMaterialSchema>;

export function emptyAssignmentMaterial(): AssignmentMaterial {
  return { mode: 'generated', sourceUrl: '', sourceText: '', sourceTextUrl: '' };
}

export function normalizeAssignmentSourceUrl(value: string): string | null {
  try {
    if (/[\s<>"'`\\]/.test(value.trim())) return null;
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.')
    )
      return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.includes(':') ||
      /^\d+(?:\.\d+){3}$/.test(host)
    )
      return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function youtubeVideoId(value: string): string | null {
  const normalized = normalizeAssignmentSourceUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  const id =
    host === 'youtu.be'
      ? parts[0]
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
        ? url.pathname === '/watch'
          ? url.searchParams.get('v')
          : ['shorts', 'embed', 'live'].includes(parts[0] ?? '')
            ? parts[1]
            : null
        : null;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export function assignmentSourceIdentity(value: string): string | null {
  const id = youtubeVideoId(value);
  return id ? `youtube:${id}` : normalizeAssignmentSourceUrl(value);
}

export const ConfirmedAssignmentMaterialSchema = AssignmentMaterialSchema.superRefine(
  (material, ctx) => {
    if (material.mode === 'generated') return;
    if (!normalizeAssignmentSourceUrl(material.sourceUrl))
      ctx.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'Enter a full public http:// or https:// source link.',
      });
    if (!material.sourceText.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['sourceText'],
        message: 'Paste a transcript or source excerpt.',
      });
    if (
      !assignmentSourceIdentity(material.sourceTextUrl) ||
      assignmentSourceIdentity(material.sourceTextUrl) !==
        assignmentSourceIdentity(material.sourceUrl)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['sourceTextUrl'],
        message: 'Confirm that this text belongs to the current source link.',
      });
  },
);

/** Effective evidence canonicalizes source attribution without mutating recovery drafts. */
export function effectiveAssignmentMaterial(material: AssignmentMaterial): AssignmentMaterial {
  return material.mode === 'generated'
    ? emptyAssignmentMaterial()
    : {
        mode: 'authentic',
        sourceUrl: normalizeAssignmentSourceUrl(material.sourceUrl) ?? material.sourceUrl,
        sourceText: material.sourceText,
        sourceTextUrl:
          normalizeAssignmentSourceUrl(material.sourceTextUrl) ?? material.sourceTextUrl,
      };
}

export function composeAssignmentMaterialNotes(
  material: AssignmentMaterial,
  guidance: string | null,
): string {
  const effective = effectiveAssignmentMaterial(material);
  return [
    effective.mode === 'generated'
      ? 'Input Type: generate'
      : `Input Type: authentic\nLink: ${effective.sourceUrl}\n\nAuthentic source text:\n${effective.sourceText}`,
    `Lesson guidance:\n${guidance?.trim() ?? ''}`,
  ].join('\n\n');
}

/** Adopt only a leading legacy selector; never infer mode from arbitrary pasted text.
 * Unknown authentic body stays visible for tutor review, never defaults to Generated.
 */
export function adoptLegacyAssignmentMaterial(notes: string | null): {
  material: AssignmentMaterial;
  teacherNotes: string | null;
} {
  const value = notes ?? '';
  const selector = /^\s*Input Type:\s*(authentic|generate)\s*(?:\r?\n|$)/i.exec(value);
  if (!selector) return { material: emptyAssignmentMaterial(), teacherNotes: notes };
  const body = value.slice(selector[0].length);
  if (selector[1]?.toLowerCase() === 'generate')
    return {
      material: emptyAssignmentMaterial(),
      teacherNotes: body.replace(/^\s*Lesson guidance:\s*\r?\n/i, '').trim() || null,
    };
  const link = /^\s*Link:\s*(https?:\/\/\S+)\s*(?:\r?\n|$)/i.exec(body);
  const sourceUrl = link?.[1] ?? '';
  const content = link ? body.slice(link[0].length) : body;
  const split = content.split(/\r?\n\s*Lesson guidance:\s*\r?\n/i);
  return {
    material: {
      mode: 'authentic',
      sourceUrl,
      sourceTextUrl: sourceUrl,
      sourceText: (split[0] ?? '').replace(/^\s*Authentic source text:\s*\r?\n/i, '').trim(),
    },
    teacherNotes: split.length > 1 ? split.slice(1).join('\n').trim() || null : null,
  };
}
