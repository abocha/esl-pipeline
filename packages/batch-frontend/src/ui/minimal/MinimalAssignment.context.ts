import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ProfileRevisionSummaryResponse } from '../../utils/api';
import {
  getProfileContent,
  listProfileContents,
  listProfileRevisions,
  restoreProfileRevision,
  upsertProfileContent,
} from '../../utils/api';

export interface ContextHydrationSnapshot {
  selectedProfileId: string;
  profileSelectionMode: 'auto' | 'manual';
}

interface UseMinimalAssignmentContextControllerParams {
  selectedStudentId: string;
  resolveBoundProfileId: (studentId: string) => string;
}

export interface ContextController extends ContextHydrationSnapshot {
  profileOptions: { id: string; label: string }[];
  profileOptionsError: string | null;
  newProfileId: string;
  profileEditorText: string;
  loadedProfileContent: string;
  profileRevisions: ProfileRevisionSummaryResponse[];
  profileRevisionError: string | null;
  profileBusy: 'loading' | 'saving' | 'creating' | 'restoring' | null;
  profileSuccess: string | null;
  profileDirty: boolean;
  setNewProfileId: (value: string) => void;
  setProfileEditorText: (value: string) => void;
  loadProfileOptions: () => Promise<void>;
  handleSelectedProfileChange: (nextProfileId: string) => void;
  handleCreateProfile: () => Promise<void>;
  handleSaveProfile: () => Promise<void>;
  handleRestoreRevision: (revisionId: string) => Promise<void>;
  applyHydratedSnapshot: (snapshot: ContextHydrationSnapshot) => void;
}

export function useMinimalAssignmentContextController({
  selectedStudentId,
  resolveBoundProfileId,
}: UseMinimalAssignmentContextControllerParams): ContextController {
  const [profileOptions, setProfileOptions] = useState<{ id: string; label: string }[]>([]);
  const [profileOptionsError, setProfileOptionsError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileSelectionMode, setProfileSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [newProfileId, setNewProfileId] = useState('');
  const [profileEditorText, setProfileEditorText] = useState('');
  const [loadedProfileContent, setLoadedProfileContent] = useState('');
  const [profileRevisions, setProfileRevisions] = useState<ProfileRevisionSummaryResponse[]>([]);
  const [profileRevisionError, setProfileRevisionError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState<
    'loading' | 'saving' | 'creating' | 'restoring' | null
  >(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const profileDirty = useMemo(
    () => profileEditorText.trim() !== loadedProfileContent.trim(),
    [loadedProfileContent, profileEditorText],
  );

  const applyHydratedSnapshot = useCallback((snapshot: ContextHydrationSnapshot) => {
    setSelectedProfileId(snapshot.selectedProfileId);
    setProfileSelectionMode(snapshot.profileSelectionMode);
  }, []);

  const loadProfileOptions = useCallback(async () => {
    try {
      const response = await listProfileContents();
      setProfileOptions(response.profiles ?? []);
      setProfileOptionsError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load profiles.';
      setProfileOptionsError(message);
    }
  }, []);

  const loadSelectedProfile = useCallback(async () => {
    if (!selectedProfileId) {
      setProfileEditorText('');
      setLoadedProfileContent('');
      setProfileRevisions([]);
      setProfileRevisionError(null);
      return;
    }

    setProfileBusy('loading');
    setProfileRevisionError(null);
    try {
      const [profile, revisions] = await Promise.all([
        getProfileContent(selectedProfileId),
        listProfileRevisions(selectedProfileId, { limit: 20, offset: 0, order: 'desc' }),
      ]);
      setProfileEditorText(profile.content ?? '');
      setLoadedProfileContent(profile.content ?? '');
      setProfileRevisions(revisions.items ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load selected profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    void loadSelectedProfile();
  }, [loadSelectedProfile]);

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

  const handleSelectedProfileChange = useCallback(
    (nextProfileId: string) => {
      if (!nextProfileId) {
        setProfileSelectionMode('auto');
        setSelectedProfileId(selectedStudentId ? resolveBoundProfileId(selectedStudentId) : '');
        return;
      }
      setProfileSelectionMode('manual');
      setSelectedProfileId(nextProfileId);
    },
    [resolveBoundProfileId, selectedStudentId],
  );

  const handleCreateProfile = useCallback(async () => {
    const candidate = newProfileId.trim();
    if (!candidate) {
      setProfileRevisionError('Profile ID is required (for example: profiles/new-student.md).');
      return;
    }

    setProfileBusy('creating');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const created = await upsertProfileContent(candidate, profileEditorText);
      await loadProfileOptions();
      setProfileSelectionMode('manual');
      setSelectedProfileId(created.id);
      setNewProfileId('');
      setProfileSuccess(`Created profile ${created.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  }, [loadProfileOptions, newProfileId, profileEditorText]);

  const handleSaveProfile = useCallback(async () => {
    if (!selectedProfileId) {
      setProfileRevisionError('Select a profile to save.');
      return;
    }

    setProfileBusy('saving');
    setProfileRevisionError(null);
    setProfileSuccess(null);
    try {
      const saved = await upsertProfileContent(selectedProfileId, profileEditorText);
      setLoadedProfileContent(saved.content);
      const revisions = await listProfileRevisions(saved.id, {
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      setProfileRevisions(revisions.items ?? []);
      setProfileSuccess(`Saved ${saved.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save profile.';
      setProfileRevisionError(message);
    } finally {
      setProfileBusy(null);
    }
  }, [profileEditorText, selectedProfileId]);

  const handleRestoreRevision = useCallback(
    async (revisionId: string) => {
      if (!selectedProfileId || !revisionId) return;

      setProfileBusy('restoring');
      setProfileRevisionError(null);
      setProfileSuccess(null);
      try {
        const restored = await restoreProfileRevision(selectedProfileId, revisionId);
        setProfileEditorText(restored.content);
        setLoadedProfileContent(restored.content);
        const revisions = await listProfileRevisions(restored.id, {
          limit: 20,
          offset: 0,
          order: 'desc',
        });
        setProfileRevisions(revisions.items ?? []);
        setProfileSuccess('Profile restored from revision.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to restore profile revision.';
        setProfileRevisionError(message);
      } finally {
        setProfileBusy(null);
      }
    },
    [selectedProfileId],
  );

  return {
    profileOptions,
    profileOptionsError,
    selectedProfileId,
    profileSelectionMode,
    newProfileId,
    profileEditorText,
    loadedProfileContent,
    profileRevisions,
    profileRevisionError,
    profileBusy,
    profileSuccess,
    profileDirty,
    setNewProfileId,
    setProfileEditorText,
    loadProfileOptions,
    handleSelectedProfileChange,
    handleCreateProfile,
    handleSaveProfile,
    handleRestoreRevision,
    applyHydratedSnapshot,
  };
}
