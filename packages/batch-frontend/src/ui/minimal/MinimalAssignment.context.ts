import { useCallback, useEffect, useRef, useState } from 'react';

import type { FoundationalProfile, ProfileContentResponse } from '../../utils/api';
import { getProfileContent, getProfileRevision } from '../../utils/api';

export interface ContextHydrationSnapshot {
  selectedProfileId: string;
  profileSelectionMode: 'auto' | 'manual';
  selectedProfileRevisionId?: string | null;
  selectedProfileRevisionHash?: string | null;
}

export type ProfilePreviewStatus = 'none' | 'loading' | 'ready' | 'unstructured' | 'error';

interface UseMinimalAssignmentContextControllerParams {
  selectedStudentId: string;
  resolveBoundProfileId: (studentId: string) => string;
}

export interface ContextController extends ContextHydrationSnapshot {
  profilePreviewStatus: ProfilePreviewStatus;
  profileRevisionError: string | null;
  profilePreview: LearnerProfilePreview | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  profileLineageReady: boolean;
  applyHydratedSnapshot: (snapshot: ContextHydrationSnapshot) => void;
  selectProfileId: (
    profileId: string,
    revision?: { id: string; contentHash: string } | null,
  ) => void;
  refreshSelectedProfile: () => void;
}

export interface LearnerProfilePreview {
  profileId: string;
  overallLevel: string | null;
  primaryGoals: string[];
  communicationContexts: string[];
  stableStrengths: string[];
  persistentChallenges: string[];
  studyPreferences: string[];
  goalsAndContexts: string[];
  strengthsAndChallenges: string[];
  teacherNoteSnippet: string | null;
  updatedAt: string | null;
}

function compactPreviewList(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function compactPreviewGoals(profile: FoundationalProfile): string[] {
  return compactPreviewList([...profile.primaryGoals, ...profile.communicationContexts]);
}

function compactPreviewStrengths(profile: FoundationalProfile): string[] {
  return compactPreviewList([...profile.stableStrengths, ...profile.persistentChallenges]);
}

function compactTeacherNote(note: string | null): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function buildProfilePreview(
  profileId: string,
  profile: Pick<ProfileContentResponse, 'structuredContent' | 'updatedAt'>,
): LearnerProfilePreview | null {
  const structured = profile.structuredContent;
  if (!structured) return null;

  return {
    profileId,
    overallLevel: structured.overallLevel ?? null,
    primaryGoals: compactPreviewList(structured.primaryGoals),
    communicationContexts: compactPreviewList(structured.communicationContexts),
    stableStrengths: compactPreviewList(structured.stableStrengths),
    persistentChallenges: compactPreviewList(structured.persistentChallenges),
    studyPreferences: compactPreviewList(structured.studyPreferences),
    goalsAndContexts: compactPreviewGoals(structured),
    strengthsAndChallenges: compactPreviewStrengths(structured),
    teacherNoteSnippet: compactTeacherNote(structured.teacherNotes),
    updatedAt: profile.updatedAt ?? null,
  };
}

function isUnstructuredProfileError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim().toLowerCase();
  return message === 'not_found' || message.includes('not structured yet');
}

export function useMinimalAssignmentContextController({
  selectedStudentId,
  resolveBoundProfileId,
}: UseMinimalAssignmentContextControllerParams): ContextController {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileSelectionMode, setProfileSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [profilePreviewStatus, setProfilePreviewStatus] = useState<ProfilePreviewStatus>('none');
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<LearnerProfilePreview | null>(null);
  const [selectedProfileRevisionId, setSelectedProfileRevisionId] = useState<string | null>(null);
  const [selectedProfileRevisionHash, setSelectedProfileRevisionHash] = useState<string | null>(
    null,
  );
  const selectedProfileIdRef = useRef('');
  const profileLineagePinnedRef = useRef(false);
  const [profileReloadToken, setProfileReloadToken] = useState(0);
  const refreshSelectedProfile = useCallback(() => {
    profileLineagePinnedRef.current = false;
    setProfileReloadToken((token) => token + 1);
  }, []);

  const applyHydratedSnapshot = useCallback((snapshot: ContextHydrationSnapshot) => {
    const profileChanged = selectedProfileIdRef.current !== snapshot.selectedProfileId;
    selectedProfileIdRef.current = snapshot.selectedProfileId;
    setSelectedProfileId(snapshot.selectedProfileId);
    setProfileSelectionMode(snapshot.profileSelectionMode);
    const hasCompleteLineage = Boolean(
      snapshot.selectedProfileId &&
        snapshot.selectedProfileRevisionId &&
        snapshot.selectedProfileRevisionHash,
    );
    profileLineagePinnedRef.current = hasCompleteLineage;
    setSelectedProfileRevisionId(
      hasCompleteLineage ? (snapshot.selectedProfileRevisionId ?? null) : null,
    );
    setSelectedProfileRevisionHash(
      hasCompleteLineage ? (snapshot.selectedProfileRevisionHash ?? null) : null,
    );
    if (snapshot.selectedProfileId && !hasCompleteLineage && !profileChanged) {
      setProfilePreviewStatus('loading');
      setProfileReloadToken((current) => current + 1);
    }
  }, []);

  const selectProfileId = useCallback(
    (profileId: string, revision?: { id: string; contentHash: string } | null) => {
      const hasCompleteLineage = Boolean(profileId && revision?.id && revision.contentHash);
      profileLineagePinnedRef.current = hasCompleteLineage;
      selectedProfileIdRef.current = profileId;
      setSelectedProfileId(profileId);
      setSelectedProfileRevisionId(hasCompleteLineage ? (revision?.id ?? null) : null);
      setSelectedProfileRevisionHash(hasCompleteLineage ? (revision?.contentHash ?? null) : null);
      setProfileSelectionMode('auto');
      setProfileReloadToken((current) => current + 1);
    },
    [],
  );

  useEffect(() => {
    if (profileSelectionMode !== 'auto') {
      return;
    }
    if (!selectedStudentId) {
      profileLineagePinnedRef.current = false;
      selectedProfileIdRef.current = '';
      setSelectedProfileId('');
      setSelectedProfileRevisionId(null);
      setSelectedProfileRevisionHash(null);
      return;
    }
    const boundProfileId = resolveBoundProfileId(selectedStudentId);
    if (selectedProfileIdRef.current !== boundProfileId) {
      profileLineagePinnedRef.current = false;
      selectedProfileIdRef.current = boundProfileId;
      setSelectedProfileRevisionId(null);
      setSelectedProfileRevisionHash(null);
      setProfilePreviewStatus(boundProfileId ? 'loading' : 'none');
    }
    setSelectedProfileId(boundProfileId);
  }, [profileSelectionMode, resolveBoundProfileId, selectedStudentId]);

  useEffect(() => {
    let active = true;

    const loadSelectedProfile = async () => {
      if (!selectedProfileId) {
        if (!active) return;
        setProfilePreviewStatus('none');
        setProfilePreview(null);
        setSelectedProfileRevisionId(null);
        setSelectedProfileRevisionHash(null);
        setProfileRevisionError(null);
        return;
      }

      try {
        setProfilePreviewStatus('loading');
        const profile = await getProfileContent(selectedProfileId);
        const revision = profile.currentRevisionId
          ? await getProfileRevision(selectedProfileId, profile.currentRevisionId)
          : null;
        if (!active) return;
        const preview = buildProfilePreview(selectedProfileId, profile);
        setProfilePreview(preview);
        if (!profileLineagePinnedRef.current) {
          setSelectedProfileRevisionId(revision?.id ?? null);
          setSelectedProfileRevisionHash(revision?.contentHash ?? null);
        }
        setProfilePreviewStatus(preview ? 'ready' : 'unstructured');
        setProfileRevisionError(null);
      } catch (error) {
        if (!active) return;
        if (isUnstructuredProfileError(error)) {
          setProfilePreviewStatus('unstructured');
          setProfilePreview(null);
          if (!profileLineagePinnedRef.current) {
            setSelectedProfileRevisionId(null);
            setSelectedProfileRevisionHash(null);
          }
          setProfileRevisionError(null);
          return;
        }
        const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
        setProfilePreviewStatus('error');
        setProfilePreview(null);
        if (!profileLineagePinnedRef.current) {
          setSelectedProfileRevisionId(null);
          setSelectedProfileRevisionHash(null);
        }
        setProfileRevisionError(message);
      }
    };

    void loadSelectedProfile();

    return () => {
      active = false;
    };
  }, [profileReloadToken, selectedProfileId]);

  const profileLineageReady =
    !selectedProfileId ||
    profilePreviewStatus === 'unstructured' ||
    Boolean(selectedProfileRevisionId && selectedProfileRevisionHash);

  return {
    selectedProfileId,
    profileSelectionMode,
    profilePreviewStatus,
    profileRevisionError,
    profilePreview,
    selectedProfileRevisionId,
    selectedProfileRevisionHash,
    profileLineageReady,
    refreshSelectedProfile,
    applyHydratedSnapshot,
    selectProfileId,
  };
}
