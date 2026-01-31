import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WizardSummary } from './WizardSummary';
import type { WizardState } from '../../context/WizardContext';
import * as WizardContext from '../../context/WizardContext';
import * as StudentSelectionContext from '../../context/StudentSelectionContext';
import type { StudentProfile } from '../../utils/api';
import * as JobMonitorContext from '../../context/JobMonitorContext';

// Mock contexts
vi.mock('../../context/WizardContext', async (importOriginal) => {
    const actual = await importOriginal<typeof WizardContext>();
    return {
        ...actual,
        useWizard: vi.fn(),
    };
});

vi.mock('../../context/StudentSelectionContext', async (importOriginal) => {
    const actual = await importOriginal<typeof StudentSelectionContext>();
    return {
        ...actual,
        useStudentSelection: vi.fn(),
    };
});

vi.mock('../../context/JobMonitorContext', async (importOriginal) => {
    const actual = await importOriginal<typeof JobMonitorContext>();
    return {
        ...actual,
        useJobMonitor: vi.fn(),
    };
});

describe('WizardSummary', () => {
    const defaultWizardState: WizardState = {
        currentStep: 0,
        activeJobId: null,
        jobState: null,
        jobMd: null,
        completedJobId: null,
        recordingId: null,
        transcriptId: null,
        transcriptText: '',
        transcriptSkipped: false,
        promptPackageId: null,
        draftId: null,
        draftText: '',
        notes: '',
        templateId: '',
        profileId: '',
        overrides: {
            preset: undefined,
            notionDatabase: undefined,
            withTts: undefined,
            forceTts: undefined,
            ttsStrategy: undefined,
            upload: 'auto',
            voiceId: undefined,
            voiceAccent: undefined,
        },
    };

    const setup = (
        wizardStateOverride: Partial<WizardState> = {},
        selectedStudent: StudentProfile | null = null,
        jobMonitorOverride: Partial<ReturnType<typeof JobMonitorContext.useJobMonitor>> = {},
    ) => {
        vi.mocked(WizardContext.useWizard).mockReturnValue({
            state: { ...defaultWizardState, ...wizardStateOverride },
            dispatch: vi.fn(),
            actions: {
                goToStep: vi.fn(),
                setJob: vi.fn(),
                updateOverrides: vi.fn(),
                reset: vi.fn(),
            },
        });

        vi.mocked(StudentSelectionContext.useStudentSelection).mockReturnValue({
            selectedStudent,
            setSelectedStudent: vi.fn(),
            updateSelectedStudent: vi.fn(),
        });

        vi.mocked(JobMonitorContext.useJobMonitor).mockReturnValue({
            jobs: [],
            jobMap: {},
            recordings: [],
            recordingMap: {},
            eventLog: [],
            lastUpdateAt: null,
            logLedgerEntries: vi.fn(),
            registerJob: vi.fn(),
            registerRecording: vi.fn(),
            refreshRecordings: vi.fn(),
            trackJob: vi.fn(),
            connectionState: 'connected',
            isPolling: false,
            lastError: null,
            liveUpdatesPaused: false,
            pauseLiveUpdates: vi.fn(),
            resumeLiveUpdates: vi.fn(),
            ...jobMonitorOverride,
        });

        return render(<WizardSummary />);
    };

    afterEach(() => {
        cleanup();
    });

    it('displays default empty states', () => {
        setup();
        expect(screen.getByText('Checklist')).not.toBeNull();
        expect(screen.getByText('Select student in Step 1')).not.toBeNull();
        expect(screen.getByText('Upload in Step 1')).not.toBeNull();
        expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    });

    it('displays student name when selected', () => {
        setup({}, { id: 's1', student: 'Alice' });
        expect(screen.getByText('Alice')).not.toBeNull();
        expect(screen.queryByText('Select student in Step 1')).toBeNull();
    });

    it('displays recording status when recordingId present', () => {
        setup(
            { recordingId: 'rec-1234567890' },
            null,
            {
                recordingMap: {
                    'rec-1234567890': {
                        recordingId: 'rec-1234567890',
                        status: 'queued',
                        transcriptId: null,
                        error: null,
                        source: 'upload',
                        studentId: null,
                        displayName: 'Lesson 1',
                        durationSec: null,
                        channels: null,
                        bytes: 1024,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    },
                },
            },
        );
        expect(screen.getByText('Lesson 1')).not.toBeNull();
    });

    it('displays statuses as Created when IDs present', () => {
        setup({
            promptPackageId: 'pp-1',
            draftId: 'draft-1'
        });
        expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    });
});
