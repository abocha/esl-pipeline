import { useCallback, useEffect, useRef, useState } from 'react';

import type { FoundationalProfile, ProfileContentResponse } from '../../utils/api';
import { getProfileContent, getProfileRevision } from '../../utils/api';

export interface ContextHydrationSnapshot {
  selectedStudentId: string;
  selectedProfileId: string;
  selectedProfileRevisionId?: string | null;
  selectedProfileRevisionHash?: string | null;
  profileAuthorityResolved?: boolean;
}

export type ProfilePreviewStatus = 'none' | 'loading' | 'ready' | 'unstructured' | 'error';

interface UseMinimalAssignmentContextControllerParams {
  selectedStudentId: string;
}

export interface ContextController extends ContextHydrationSnapshot {
  profilePreviewStatus: ProfilePreviewStatus;
  profileRevisionError: string | null;
  profilePreview: LearnerProfilePreview | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  profileAuthorityResolved: boolean;
  profileLineageReady: boolean;
  applyHydratedSnapshot: (snapshot: ContextHydrationSnapshot) => void;
  refreshSelectedProfile: () => void;
}

export interface LearnerProfilePreview {
  studentId: string;
  overallLevel: string | null;
  primaryGoals: string[];
  communicationContexts: string[];
  stableStrengths: string[];
  persistentChallenges: string[];
  studyPreferences: string[];
  interests: string[];
  durableConstraints: string[];
  goalsAndContexts: string[];
  strengthsAndChallenges: string[];
  teacherNoteSnippet: string | null;
  updatedAt: string | null;
}

function compactPreviewList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
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
  return trimmed;
}

export function buildProfilePreview(
  studentId: string,
  profile: Pick<ProfileContentResponse, 'structuredContent' | 'updatedAt'>,
): LearnerProfilePreview | null {
  const structured = profile.structuredContent;
  if (!structured) return null;

  return {
    studentId,
    overallLevel: structured.overallLevel ?? null,
    primaryGoals: compactPreviewList(structured.primaryGoals),
    communicationContexts: compactPreviewList(structured.communicationContexts),
    stableStrengths: compactPreviewList(structured.stableStrengths),
    persistentChallenges: compactPreviewList(structured.persistentChallenges),
    studyPreferences: compactPreviewList(structured.studyPreferences),
    interests: compactPreviewList(structured.interestsAndUsefulThemes),
    durableConstraints: compactPreviewList(structured.durableConstraints),
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
}: UseMinimalAssignmentContextControllerParams): ContextController {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profilePreviewStatus, setProfilePreviewStatus] = useState<ProfilePreviewStatus>('none');
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<LearnerProfilePreview | null>(null);
  const [selectedProfileRevisionId, setSelectedProfileRevisionId] = useState<string | null>(null);
  const [selectedProfileRevisionHash, setSelectedProfileRevisionHash] = useState<string | null>(
    null,
  );
  const selectedProfileIdRef = useRef('');
  const profileLineagePinnedRef = useRef(false);
  const profileAuthorityPinnedRef = useRef(false);
  const profileAuthorityStudentIdRef = useRef(selectedStudentId);
  const [profileAuthorityResolved, setProfileAuthorityResolved] = useState(false);
  const [profileReloadToken, setProfileReloadToken] = useState(0);
  const refreshSelectedProfile = useCallback(() => {
    profileLineagePinnedRef.current = false;
    setProfileReloadToken((token) => token + 1);
  }, []);

  const applyHydratedSnapshot = useCallback((snapshot: ContextHydrationSnapshot) => {
    const profileChanged = selectedProfileIdRef.current !== snapshot.selectedProfileId;
    selectedProfileIdRef.current = snapshot.selectedProfileId;
    setSelectedProfileId(snapshot.selectedProfileId);
    const hasCompleteLineage = Boolean(
      snapshot.selectedProfileId &&
        snapshot.selectedProfileRevisionId &&
        snapshot.selectedProfileRevisionHash,
    );
    const authorityResolved = snapshot.profileAuthorityResolved ?? hasCompleteLineage;
    profileLineagePinnedRef.current = hasCompleteLineage;
    profileAuthorityPinnedRef.current = authorityResolved;
    profileAuthorityStudentIdRef.current = snapshot.selectedStudentId;
    setProfileAuthorityResolved(authorityResolved);
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

  useEffect(() => {
    if (profileAuthorityStudentIdRef.current !== selectedStudentId) {
      profileAuthorityStudentIdRef.current = selectedStudentId;
      profileAuthorityPinnedRef.current = false;
      profileLineagePinnedRef.current = false;
      setProfileAuthorityResolved(false);
    }
    if (!selectedStudentId) {
      profileLineagePinnedRef.current = false;
      selectedProfileIdRef.current = '';
      setSelectedProfileId('');
      setSelectedProfileRevisionId(null);
      setSelectedProfileRevisionHash(null);
      setProfileAuthorityResolved(true);
      return;
    }
    if (profileAuthorityPinnedRef.current) {
      return;
    }
    const profileStudentId = selectedStudentId;
    if (selectedProfileIdRef.current !== profileStudentId) {
      profileLineagePinnedRef.current = false;
      selectedProfileIdRef.current = profileStudentId;
      setSelectedProfileRevisionId(null);
      setSelectedProfileRevisionHash(null);
      setProfilePreviewStatus(profileStudentId ? 'loading' : 'none');
    }
    setSelectedProfileId(profileStudentId);
    setProfileAuthorityResolved(true);
  }, [selectedStudentId]);

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
    profileAuthorityResolved &&
    (!selectedProfileId ||
      profilePreviewStatus === 'unstructured' ||
      Boolean(selectedProfileRevisionId && selectedProfileRevisionHash));

  return {
    selectedStudentId,
    selectedProfileId,
    profilePreviewStatus,
    profileRevisionError,
    profilePreview,
    selectedProfileRevisionId,
    selectedProfileRevisionHash,
    profileAuthorityResolved,
    profileLineageReady,
    refreshSelectedProfile,
    applyHydratedSnapshot,
  };
}
