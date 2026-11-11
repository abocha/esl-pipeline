import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import type { ProfileMaintenanceChangeDto } from '@esl-pipeline/contracts';

import type { ProfileContentResponse, ProfileRevisionDetailResponse } from '../utils/api';

// Fictional, in-memory UI evidence. No production profile or provider is accessed.
export function createProfileMaintenanceSandbox(
  seed: ProfileContentResponse,
  draft: ProfileRevisionDetailResponse,
  firstDraft: ProfileRevisionDetailResponse,
  historical: ProfileRevisionDetailResponse[],
) {
  const profiles = new Map<string, ProfileContentResponse | null>([
    [seed.studentId, structuredClone(seed)],
    [firstDraft.studentId, null],
  ]);
  const revisions = new Map<string, ProfileRevisionDetailResponse>(
    [draft, firstDraft, ...historical].map((item) => [item.id, structuredClone(item)]),
  );
  const basePreferences = seed.structuredContent?.studyPreferences ?? [];
  const additions = ['Prefers ten-minute daily review.', 'Prefers examples from current work.'];
  const changes: ProfileMaintenanceChangeDto[] = additions
    .map(
      (value, index): ProfileMaintenanceChangeDto => ({
        id: `mock-profile-change-${index + 1}`,
        field: 'studyPreferences',
        addedValue: value,
        beforeValue: [...basePreferences, ...additions.slice(0, index)],
        afterValue: [...basePreferences, ...additions.slice(0, index + 1)],
        appliedAt: `2026-07-0${index + 1}T10:00:00.000Z`,
        sourceRevisionId: `profile-revision-sandbox-v${index + 3}`,
        resultRevisionId: index === 0 ? 'profile-revision-sandbox-v4' : seed.activeRevisionId!,
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: [`mock-lesson-memory-${index + 1}`],
        sourceLessonIds: [`mock-lesson-${index + 1}`],
        status: index === 0 ? 'blocked' : 'applied',
        canUndo: index === 1,
        blockedReason: index === 0 ? 'field_changed' : null,
        undoneAt: null,
        reconsiderationAvailable: false,
        evidence: [
          {
            lessonMemoryId: `mock-lesson-memory-${index + 1}`,
            lessonId: `mock-lesson-${index + 1}`,
            lessonStartedAt: `2026-07-0${index + 1}T08:00:00.000Z`,
            facts: [
              {
                fact: value,
                evidence: [
                  {
                    quote:
                      index === 0
                        ? 'I review for ten minutes every day.'
                        : 'Examples from my current work help me most.',
                    speakerRole: 'student',
                    sourceId: `mock-transcript-${index + 1}`,
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    .reverse();
  if (seed.structuredContent)
    profiles.set(seed.studentId, {
      ...seed,
      structuredContent: {
        ...seed.structuredContent,
        studyPreferences: [...basePreferences, ...additions],
      },
    });
  if (seed.currentRevisionId && revisions.has(seed.currentRevisionId))
    revisions.set(seed.currentRevisionId, {
      ...revisions.get(seed.currentRevisionId)!,
      structuredContent: profiles.get(seed.studentId)?.structuredContent,
    });
  let sequence = 0;
  const getProfile = (studentId: string) => profiles.get(studentId) ?? null;
  const listRevisions = (studentId: string) => {
    const items = [...revisions.values()]
      .filter((item) => item.studentId === studentId)
      .sort((left, right) => (right.versionNumber ?? 0) - (left.versionNumber ?? 0));
    return { items, total: items.length, limit: 25, offset: 0, order: 'desc' };
  };
  const register = (studentId: string, profile: ProfileContentResponse | null) => {
    profiles.set(studentId, profile);
  };

  const handle = (config: InternalAxiosRequestConfig, path: string): unknown | undefined => {
    const route = path.match(
      /^\/students\/([^/]+)\/(profile(?:\/.*)?|profile-drafts\/initialize|profile-drafts\/refresh-from-approved-candidates|profile-candidates\/promote)$/,
    );
    if (!route) return undefined;
    const studentId = decodeURIComponent(route[1]!);
    if (!profiles.has(studentId)) return undefined;
    const suffix = route[2]!;
    const method = (config.method ?? 'get').toLowerCase();
    const body =
      typeof config.data === 'string'
        ? (JSON.parse(config.data) as Record<string, unknown>)
        : ((config.data ?? {}) as Record<string, unknown>);
    const current = getProfile(studentId);
    const head = current?.activeRevisionId ?? null;
    const fail = (status: number, code: string, message: string): never => {
      throw new AxiosError(message, String(status), config, undefined, {
        data: { error: code, code, message, activeRevisionId: head },
        status,
        statusText: message,
        headers: {},
        config,
      });
    };
    if (method === 'get') {
      if (suffix === 'profile') return current ?? fail(404, 'not_found', 'Profile unavailable.');
      if (suffix === 'profile/revisions') return listRevisions(studentId);
      if (suffix === 'profile/changes')
        return {
          studentId,
          activeRevisionId: head,
          items: studentId === seed.studentId && !config.params?.cursor ? changes : [],
          nextCursor: null,
        };
      const revisionId = suffix.match(/^profile\/revisions\/([^/]+)$/)?.[1];
      if (revisionId)
        return (
          revisions.get(decodeURIComponent(revisionId)) ??
          fail(404, 'not_found', 'Profile version unavailable.')
        );
      return undefined;
    }
    if (!['put', 'post'].includes(method)) return undefined;
    if (!Object.hasOwn(body, 'expectedActiveRevisionId'))
      return fail(
        428,
        'profile_revision_precondition_required',
        'Review the current profile before saving.',
      );
    const completedUndoId = suffix.match(/^profile\/changes\/([^/]+)\/undo$/)?.[1];
    const completedUndo =
      studentId === seed.studentId && completedUndoId
        ? changes.find(
            (item) => item.id === decodeURIComponent(completedUndoId) && item.status === 'undone',
          )
        : undefined;
    if (completedUndo) return { profile: current, change: completedUndo };
    if (body.expectedActiveRevisionId !== head)
      return fail(409, 'profile_revision_conflict', 'The profile has changed.');
    const nextRevision = (
      structuredContent: ProfileContentResponse['structuredContent'],
      status: 'draft' | 'active',
      source: ProfileRevisionDetailResponse['source'],
      id?: string,
    ): ProfileRevisionDetailResponse => ({
      id: id ?? `profile-revision-mock-${++sequence}`,
      studentId,
      contentHash: `mock-profile-hash-${sequence}`,
      source,
      status,
      versionNumber:
        (current ? (revisions.get(current.currentRevisionId ?? '')?.versionNumber ?? 5) : 0) + 1,
      versionLabel: `v${(current ? (revisions.get(current.currentRevisionId ?? '')?.versionNumber ?? 5) : 0) + 1}`,
      createdAt: new Date().toISOString(),
      activatedAt: status === 'active' ? new Date().toISOString() : null,
      deprecatedAt: null,
      createdBy: 'sandbox-tutor',
      restoredFromRevisionId: null,
      baseActiveRevisionId: head,
      baseActiveRevisionKnown: true,
      content: typeof body.content === 'string' ? body.content : (current?.content ?? ''),
      structuredContent,
    });
    const activate = (revision: ProfileRevisionDetailResponse) => {
      for (const item of changes)
        if (
          studentId === seed.studentId &&
          item.status === 'applied' &&
          JSON.stringify(current?.structuredContent?.[item.field]) !==
            JSON.stringify(revision.structuredContent?.[item.field])
        ) {
          item.status = 'blocked';
          item.canUndo = false;
          item.blockedReason = 'field_changed';
        }
      if (head && revisions.has(head))
        revisions.set(head, { ...revisions.get(head)!, status: 'deprecated' });
      const active = {
        ...revision,
        status: 'active' as const,
        activatedAt: new Date().toISOString(),
      };
      revisions.set(active.id, active);
      profiles.set(studentId, {
        studentId,
        content: active.content,
        structuredContent: active.structuredContent,
        currentRevisionId: active.id,
        activeRevisionId: active.id,
        updatedAt: active.activatedAt,
      });
      return active;
    };
    if (method === 'put' && suffix === 'profile') {
      activate(
        nextRevision(
          (body.structuredContent ??
            current?.structuredContent) as ProfileContentResponse['structuredContent'],
          'active',
          'update',
        ),
      );
      return getProfile(studentId);
    }
    if (suffix === 'profile-drafts/initialize') {
      if (head) return fail(409, 'profile_revision_conflict', 'A profile already exists.');
      const empty = {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      };
      const revision = nextRevision(empty, 'draft', 'create');
      revisions.set(revision.id, revision);
      return { draftRevisionId: revision.id, draftRevision: revision };
    }
    if (suffix === 'profile/revisions') {
      const revision = nextRevision(
        (body.structuredContent ??
          draft.structuredContent) as ProfileContentResponse['structuredContent'],
        'draft',
        'update',
        'profile-revision-sandbox-saved-draft',
      );
      revisions.set(revision.id, revision);
      return revision;
    }
    if (
      suffix === 'profile-drafts/refresh-from-approved-candidates' ||
      suffix === 'profile-candidates/promote'
    ) {
      const revision = {
        ...draft,
        studentId,
        baseActiveRevisionId: head,
        baseActiveRevisionKnown: true,
      };
      revisions.set(revision.id, revision);
      return {
        draftRevisionId: revision.id,
        draftRevision: revision,
        includedCandidateIds: body.candidateIds ?? [],
        excludedCandidateIds: [],
      };
    }
    const undoId = suffix.match(/^profile\/changes\/([^/]+)\/undo$/)?.[1];
    if (undoId) {
      const item =
        studentId === seed.studentId
          ? changes.find((candidate) => candidate.id === decodeURIComponent(undoId))
          : undefined;
      if (!item || !current?.structuredContent)
        return fail(404, 'not_found', 'Profile update unavailable.');
      if (item.status === 'undone') return { profile: current, change: item };
      if (!item.canUndo)
        return fail(409, 'profile_change_conflict', 'This field changed after the update.');
      const content = {
        ...current.structuredContent,
        [item.field]: current.structuredContent[item.field].filter(
          (value) => value !== item.addedValue,
        ),
      };
      activate(nextRevision(content, 'active', 'maintenance_undo'));
      item.status = 'undone';
      item.canUndo = false;
      item.blockedReason = null;
      item.undoneAt = new Date().toISOString();
      return { profile: getProfile(studentId), change: item };
    }
    const revisionAction = suffix.match(/^profile\/revisions\/([^/]+)\/(activate|restore)$/);
    if (revisionAction) {
      const revision = revisions.get(decodeURIComponent(revisionAction[1]!));
      if (!revision || revision.studentId !== studentId)
        return fail(404, 'not_found', 'Profile version unavailable.');
      if (revisionAction[2] === 'activate') {
        if (!revision.baseActiveRevisionKnown || revision.baseActiveRevisionId !== head)
          return fail(
            409,
            'profile_revision_conflict',
            'Compare this draft with the current profile first.',
          );
        return activate(revision);
      }
      activate(nextRevision(revision.structuredContent, 'active', 'restore'));
      return getProfile(studentId);
    }
    return undefined;
  };
  return { getProfile, listRevisions, register, handle };
}
