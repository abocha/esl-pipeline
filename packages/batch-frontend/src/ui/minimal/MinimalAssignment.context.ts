import { useCallback, useEffect, useState } from 'react';

import type { FoundationalProfile, ProfileContentResponse } from '../../utils/api';
import { getProfileContent } from '../../utils/api';

export interface ContextHydrationSnapshot {
  selectedProfileId: string;
  profileSelectionMode: 'auto' | 'manual';
}

interface UseMinimalAssignmentContextControllerParams {
  selectedStudentId: string;
  resolveBoundProfileId: (studentId: string) => string;
}

export interface ContextController extends ContextHydrationSnapshot {
  profileRevisionError: string | null;
  profilePreview: LearnerProfilePreview | null;
  applyHydratedSnapshot: (snapshot: ContextHydrationSnapshot) => void;
}

export interface LearnerProfilePreview {
  profileId: string;
  overallLevel: string | null;
  goalsAndContexts: string[];
  strengthsAndChallenges: string[];
  teacherNoteSnippet: string | null;
  updatedAt: string | null;
}

function compactPreviewList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, 3);
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
    goalsAndContexts: compactPreviewGoals(structured),
    strengthsAndChallenges: compactPreviewStrengths(structured),
    teacherNoteSnippet: compactTeacherNote(structured.teacherNotes),
    updatedAt: profile.updatedAt ?? null,
  };
}

export function useMinimalAssignmentContextController({
  selectedStudentId,
  resolveBoundProfileId,
}: UseMinimalAssignmentContextControllerParams): ContextController {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileSelectionMode, setProfileSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profilePreview, setProfilePreview] = useState<LearnerProfilePreview | null>(null);

  const applyHydratedSnapshot = useCallback((snapshot: ContextHydrationSnapshot) => {
    setSelectedProfileId(snapshot.selectedProfileId);
    setProfileSelectionMode(snapshot.profileSelectionMode);
  }, []);

  useEffect(() => {
    if (profileSelectionMode !== 'auto') {
      return;
    }
    if (!selectedStudentId) {
      setSelectedProfileId('');
      return;
    }
    const boundProfileId = resolveBoundProfileId(selectedStudentId);
    setSelectedProfileId((current) => (current === boundProfileId ? current : boundProfileId));
  }, [profileSelectionMode, resolveBoundProfileId, selectedStudentId]);

  useEffect(() => {
    let active = true;

    const loadSelectedProfile = async () => {
      if (!selectedProfileId) {
        if (!active) return;
        setProfilePreview(null);
        setProfileRevisionError(null);
        return;
      }

      try {
        const profile = await getProfileContent(selectedProfileId);
        if (!active) return;
        setProfilePreview(buildProfilePreview(selectedProfileId, profile));
        setProfileRevisionError(null);
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
        setProfilePreview(null);
        setProfileRevisionError(message);
      }
    };

    void loadSelectedProfile();

    return () => {
      active = false;
    };
  }, [selectedProfileId]);

  return {
    selectedProfileId,
    profileSelectionMode,
    profileRevisionError,
    profilePreview,
    applyHydratedSnapshot,
  };
}
