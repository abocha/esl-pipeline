// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AssignmentV1, serializeAssignmentV1 } from '@esl-pipeline/contracts';

import * as api from '../../utils/api';
import {
  type AuthoringHydrationSnapshot,
  useMinimalAssignmentAuthoringController,
} from './MinimalAssignment.authoring';

vi.mock('../../utils/api', async () => ({
  ...(await vi.importActual('../../utils/api')),
  updateDraft: vi.fn(),
  fetchDraft: vi.fn(),
  renderHtmlPreview: vi.fn(),
}));

const assignment: AssignmentV1 = {
  schemaVersion: 1,
  metadata: { title: 'Plan a trip', student: 'Alex', level: 'B1', topic: 'Travel' },
  mission: { goal: 'Explain your plan.', keyLanguage: ['going to'] },
  input: {
    kind: 'generate',
    source: { title: null, attribution: null, url: null },
    media: [],
    studyText: {
      type: 'monologue',
      speakers: [
        {
          id: 'alex',
          displayName: 'Alex',
          role: 'Traveller',
          persona: null,
          voiceDirection: null,
          gender: 'neutral',
          age: null,
          accent: null,
        },
      ],
      turns: [{ speakerId: 'alex', text: 'I am going to travel.' }],
    },
    comprehension: [{ prompt: 'What is the plan?', answer: 'Travel.', explanation: null }],
  },
  toolkit: {
    grammar: [
      {
        name: 'Plans',
        form: 'going to',
        explanation: 'Talk about plans.',
        examples: ['I am going to travel.'],
        uses: [],
        traps: [],
      },
    ],
    vocabulary: [{ expression: 'travel', meaning: 'Go somewhere.', example: 'I travel.' }],
  },
  practice: [
    {
      title: null,
      instructions: null,
      items: [{ prompt: 'I ... travel.', answer: 'am going to', explanation: null }],
    },
  ],
  pronunciation: null,
  outputTask: {
    task: 'Explain your trip.',
    extension: null,
    sampleResponse: 'I am going to travel.',
  },
  rationale: 'Practise plans.',
  teacherFollowUp: { warmUp: 'Explain a plan.', correctionFocus: 'going to' },
};
const context = { studentName: 'Alex', inputKind: 'generate' as const, suppliedUrls: [] };
function draft(value = assignment, version = 1): api.DraftResponse {
  return {
    id: 'draft-1',
    promptPackageId: 'prompt-1',
    studentId: 'student-1',
    format: 'assignment_v1',
    assignment: value,
    validationContext: context,
    workingVersion: version,
    contentHash: String(version).repeat(64),
    storageUri: `local://drafts/draft-1/content/${String(version).repeat(64)}.json`,
    createdBy: 'user-1',
    createdAt: '2026-10-03T00:00:00Z',
    updatedAt: '2026-10-03T00:00:00Z',
    text: JSON.stringify(value, null, 2),
  };
}
const params = {
  recordingId: 'recording-1',
  getAssignmentSessionId: () => 'session-1',
  transcriptStatus: 'ready' as const,
  teacherNotes: '',
  selectedTemplateId: 'hw_prompt_assignment_v1.md',
  currentJobId: null,
  learningPresetCatalogEnabled: false,
  presetOptionIds: [],
  generationOptions: null,
  ttsProviders: [],
  ttsModelOptionsByProvider: { elevenlabs: [], google: [], inworld: [] },
  elevenlabsModelOptions: [],
  elevenlabsStandardModelOptions: [],
  defaultTtsProvider: null,
  defaultTtsModelByProvider: null,
  configuredTtsStrategies: [],
  onDraftPronunciationModeDetected: vi.fn(),
  onTeacherNotesResolved: vi.fn(),
};
function setup(saved = draft()) {
  const hook = renderHook(() => useMinimalAssignmentAuthoringController(params));
  act(() =>
    hook.result.current.applyHydrationSnapshot({
      publishTarget: 'html',
      selectedTtsProvider: 'inworld',
      selectedTtsStrategy: 'auto',
      selectedTtsModel: '',
      selectedPreset: '',
      selectedGenerationProvider: '',
      selectedGenerationModel: '',
      promptPackage: {
        id: 'prompt-1',
        text: 'Prompt',
        requestEnvelope: { promptVersion: 'assignment_v1', assignmentContext: context },
      },
      promptText: 'Prompt',
      promptError: null,
      draft: saved,
      draftText: saved.text,
      draftError: null,
      publishError: null,
      previewHtml: null,
      previewError: null,
      lastPreviewedDraftHash: null,
      validation: null,
      validationError: null,
    } as unknown as AuthoringHydrationSnapshot),
  );
  return hook;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AssignmentV1 authoring and historical access', () => {
  it('keeps original Markdown inspectable and rejects edits, autosave, preview, and regeneration', async () => {
    const historical = {
      ...draft(),
      format: 'markdown' as const,
      artifact: undefined,
      assignment: undefined,
      text: '# Original historical bytes',
    };
    const { result } = setup(historical);
    expect(result.current.draftText).toBe(historical.text);
    expect(result.current.draftValid).toBe(false);
    expect(result.current.canPublishWithPreview).toBe(false);
    act(() => result.current.setDraftText('# Attempted edit'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
      await result.current.previewDraft();
      await result.current.saveDraft();
    });
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(api.renderHtmlPreview).not.toHaveBeenCalled();
    expect(result.current.draft?.text).toBe(historical.text);
    expect(await result.current.generateAssignment()).toBeNull();
    expect(result.current.previewError).toMatch(/validation/i);
  });
  it('does not flush an older autosave after another valid edit and retains the newer local buffer', async () => {
    const { result } = setup();
    const first = structuredClone(assignment);
    first.metadata.title = 'First autosave';
    const later = structuredClone(assignment);
    later.metadata.title = 'Later local edit';
    let complete!: (value: api.DraftResponse) => void;
    vi.mocked(api.updateDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => result.current.setDraftText(JSON.stringify(first)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    let flush!: Promise<api.DraftResponse | null>;
    act(() => {
      flush = result.current.flushDraftAutosave();
    });
    act(() => result.current.setDraftText(JSON.stringify(later)));
    await act(async () => {
      complete(draft(first, 2));
    });
    expect(await flush).toBeNull();
    expect(result.current.isCurrentDraftSaved(result.current.draft)).toBe(false);
    expect(result.current.draftText).toBe(JSON.stringify(later));
    expect(api.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('does not return an older save for confirmation when the buffer changed to another valid assignment', async () => {
    const { result } = setup();
    const first = structuredClone(assignment);
    first.metadata.title = 'First edit';
    const later = structuredClone(assignment);
    later.metadata.title = 'Later edit';
    let complete!: (value: api.DraftResponse) => void;
    vi.mocked(api.updateDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => result.current.setDraftText(JSON.stringify(first)));
    let save!: Promise<api.DraftResponse | null>;
    await act(async () => {
      save = result.current.saveDraft();
    });
    act(() => result.current.setDraftText(JSON.stringify(later)));
    await act(async () => {
      complete(draft(first, 2));
    });
    expect(await save).toBeNull();
    expect(result.current.draftText).toBe(JSON.stringify(later));
    expect(result.current.draft?.assignment).toEqual(first);
  });

  it('flushes an in-flight canonical match without resaving pretty-print differences with stale CAS', async () => {
    const { result } = setup();
    const next = structuredClone(assignment);
    next.metadata.title = 'Saved edit';
    let complete!: (value: api.DraftResponse) => void;
    vi.mocked(api.updateDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => result.current.setDraftText(serializeAssignmentV1(next)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    let flush!: Promise<api.DraftResponse | null>;
    act(() => {
      flush = result.current.flushDraftAutosave();
    });
    await act(async () => {
      complete(draft(next, 2));
    });
    expect(await flush).toEqual(draft(next, 2));
    expect(api.updateDraft).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['{', 'syntax error'],
    [
      JSON.stringify({ ...assignment, metadata: { ...assignment.metadata, title: 3 } }),
      'metadata.title',
    ],
    [JSON.stringify({ ...assignment, practice: [] }), 'practice must not be empty'],
  ])('keeps invalid editor state local and blocks save/preview: %s', async (text, message) => {
    const hook = setup();
    act(() => hook.result.current.setDraftText(text));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(hook.result.current.assignmentValidationError).toContain(message);
    expect(hook.result.current.draftValid).toBe(false);
    expect(hook.result.current.canPublishWithPreview).toBe(false);
    let saved;
    await act(async () => {
      saved = await hook.result.current.flushDraftAutosave();
      await hook.result.current.previewDraft();
    });
    expect(saved).toBeNull();
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(api.renderHtmlPreview).not.toHaveBeenCalled();
    expect(hook.result.current.draft?.assignment).toEqual(assignment);
    hook.unmount();
    const reloaded = setup();
    expect(reloaded.result.current.draftText).toBe(draft().text);
  });

  it('ignores formatting changes for dirty/preview identity and previews the validated object', async () => {
    const { result } = setup();
    vi.mocked(api.renderHtmlPreview).mockResolvedValue({ html: '<p>Preview</p>' });
    await act(async () => {
      await result.current.previewDraft();
    });
    expect(api.renderHtmlPreview).toHaveBeenCalledWith(
      expect.objectContaining({ assignment, promptPackageId: 'prompt-1' }),
    );
    act(() => result.current.setDraftText(serializeAssignmentV1(assignment)));
    expect(result.current.draftDirty).toBe(false);
    expect(result.current.previewReadyForCurrentDraft).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.updateDraft).not.toHaveBeenCalled();
  });

  it('autosaves valid changes with CAS, preserves an invalid buffer during an in-flight save, then resumes the saved valid content', async () => {
    const { result } = setup();
    const next = structuredClone(assignment);
    next.metadata.title = 'Updated title';
    let complete!: (value: api.DraftResponse) => void;
    vi.mocked(api.updateDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => result.current.setDraftText(JSON.stringify(next)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.updateDraft).toHaveBeenCalledWith('draft-1', JSON.stringify(next), 1);
    act(() => result.current.setDraftText('{ incomplete'));
    await act(async () => {
      complete(draft(next, 2));
    });
    expect(result.current.draftText).toBe('{ incomplete');
    expect(result.current.draft?.assignment).toEqual(next);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('preserves the local JSON buffer on CAS conflict and keeps the newer durable version', async () => {
    const { result } = setup();
    const local = structuredClone(assignment);
    local.metadata.title = 'Local';
    const remote = structuredClone(assignment);
    remote.metadata.title = 'Remote';
    vi.mocked(api.updateDraft).mockRejectedValueOnce(
      new api.ArtifactWorkingConflictApiError({ workingVersion: 2, contentHash: '2'.repeat(64) }),
    );
    vi.mocked(api.fetchDraft).mockResolvedValue(draft(remote, 2));
    act(() => result.current.setDraftText(JSON.stringify(local)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.draftText).toBe(JSON.stringify(local));
    expect(result.current.draftRecoveryConflict).toBe(true);
    expect(result.current.draft?.workingVersion).toBe(2);
    expect(result.current.draft?.assignment).toEqual(remote);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(api.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('does not admit confirmation or correction through a flush whose buffer became invalid while awaiting autosave', async () => {
    const { result } = setup();
    const next = structuredClone(assignment);
    next.metadata.title = 'Saved valid title';
    let complete!: (value: api.DraftResponse) => void;
    vi.mocked(api.updateDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    act(() => result.current.setDraftText(JSON.stringify(next)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    let flush!: Promise<api.DraftResponse | null>;
    act(() => {
      flush = result.current.flushDraftAutosave();
    });
    act(() => result.current.setDraftText('{ invalid during flush'));
    await act(async () => {
      complete(draft(next, 2));
    });
    expect(await flush).toBeNull();
    expect(result.current.isCurrentDraftValid()).toBe(false);
    expect(result.current.draft?.assignment).toEqual(next);
    expect(result.current.draftText).toBe('{ invalid during flush');
  });
});
