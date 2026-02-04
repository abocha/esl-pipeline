import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WizardProvider } from '../../context/WizardContext';
import { AssignmentWizard } from './AssignmentWizard';
import type { JobStatus } from '../../utils/api';
import * as api from '../../utils/api';
import { StudentSelectionProvider } from '../../context/StudentSelectionContext';
import { JobSettingsProvider } from '../../context/JobSettingsContext';
import { AuthProvider } from '../../context/AuthContext';
import * as JobMonitorContext from '../../context/JobMonitorContext';

// Mock JobMonitorContext
const mockRegisterRecording = vi.fn();
let mockJobMap: Record<string, JobStatus> = {};
vi.mock('../../context/JobMonitorContext', async (importOriginal) => {
    const actual = await importOriginal<typeof JobMonitorContext>();
    return {
        ...actual,
        useJobMonitor: vi.fn(),
        JobMonitorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
});

// Mock API
vi.mock('../../utils/api', async (importOriginal) => {
    const actual = await importOriginal<typeof api>();
    return {
        ...actual,
        fetchStudentOptions: vi.fn(),
        uploadRecording: vi.fn(),
        fetchRecordingTranscript: vi.fn(),
        updateRecordingTranscript: vi.fn(),
        createPromptPackage: vi.fn(),
        fetchPromptPackage: vi.fn(),
        createDraft: vi.fn(),
        updateDraft: vi.fn(),
        materializeDraft: vi.fn(),
        approveJob: vi.fn(),
        validateMarkdown: vi.fn(),
        getJobStatus: vi.fn(),
        fetchDraft: vi.fn(),
        fetchJobOptions: vi.fn().mockResolvedValue({
            presets: ['b1-default'],
            voiceAccents: [],
            voices: [],
            notionDatabases: [],
            ttsStrategies: ['auto'],
        }), // Mock for JobSettings
        refreshToken: vi.fn().mockResolvedValue({
            user: { id: 'u1', email: 'test@example.com', role: 'user', isActive: true },
            accessToken: 'access-token',
        }),
        checkAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: true, user: { id: 'u1', email: 'test@example.com' } }),
        subscribeToJobEvents: vi.fn().mockReturnValue(() => { }), // Returns cleanup fn
        listRecordings: vi.fn().mockResolvedValue({ items: [] }),
        listUserJobs: vi.fn().mockResolvedValue({ jobs: [] }),
    };
});

// Mock Icons to avoid SVG issues in tests
vi.mock('../shared/Icons', () => ({
    Icons: {
        ArrowLeft: () => <span data-testid="icon-arrow-left" />,
        ArrowRight: () => <span data-testid="icon-arrow-right" />,
        Check: () => <span data-testid="icon-check" />,
        CloudArrowUp: () => <span data-testid="icon-cloud" />,
        DocumentText: () => <span data-testid="icon-doc" />,
        PencilSquare: () => <span data-testid="icon-pencil" />,
        RocketLaunch: () => <span data-testid="icon-rocket" />,
        User: () => <span data-testid="icon-user" />,
        XMark: () => <span data-testid="icon-x" />,
        Refresh: () => <span data-testid="icon-refresh" />,
        Plus: () => <span data-testid="icon-plus" />,
        Home: () => <span data-testid="icon-home" />,
    },
}));

// Mock DropZone and Editor to simplify
vi.mock('../shared/DropZone', () => ({
    DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
        <div data-testid="dropzone">
            <button onClick={() => onFiles([new File(['audio'], 'test.mp3', { type: 'audio/mp3' })])}>
                Upload File
            </button>
        </div>
    ),
}));

vi.mock('../editor/MarkdownEditor', () => ({
    MarkdownEditor: ({ value, onChange }: { value: string; onChange: (val: string) => void }) => (
        <textarea
            data-testid="markdown-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

vi.mock('../editor/MarkdownPreview', () => ({
    MarkdownPreview: ({ value }: { value: string }) => (
        <div data-testid="markdown-preview">{value}</div>
    ),
}));

describe('AssignmentWizard Integration', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.localStorage.clear();
        mockJobMap = {};
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.mocked(api.fetchStudentOptions).mockResolvedValue({
            students: [
                { id: 's1', name: 'Alice', profileId: 'p1' },
                { id: 's2', name: 'Bob', profileId: 'p2' },
            ],
        });
        vi.mocked(api.fetchRecordingTranscript).mockResolvedValue({
            recordingId: 'rec-123',
            transcriptId: 'tx-123',
            text: 'Transcript Text',
            summaryJson: null,
            model: 'test-model',
            language: 'en',
            mode: 'stack',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        vi.mocked(api.createPromptPackage).mockResolvedValue({
            id: 'pp-123',
            recordingId: 'rec-123',
            transcriptId: 'tx-123',
            studentId: 's1',
            profilePath: null,
            templateVersion: 't1',
            notes: null,
            storageUri: 'memory://prompt',
            text: 'Prompt Text',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        vi.mocked(api.createDraft).mockResolvedValue({
            id: 'draft-123',
            promptPackageId: 'pp-123',
            studentId: 's1',
            storageUri: 'memory://draft',
            createdBy: 'u1',
            text: 'Draft Text',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        vi.mocked(api.materializeDraft).mockResolvedValue({
            draftId: 'draft-123',
            jobId: 'job-123',
            mdPath: '/uploads/draft-123.md',
        });
        vi.mocked(api.approveJob).mockResolvedValue({
            jobId: 'job-123',
            md: '/uploads/draft-123.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: null,
            draftId: 'draft-123',
            preset: null,
            withTts: null,
            voiceId: null,
            upload: null,
            voiceAccent: null,
            forceTts: null,
            notionDatabase: null,
            publishTarget: 'notion',
            ttsStrategy: null,
            notionUrl: null,
            anytypeUrl: null,
            autoPublish: null,
            state: 'queued',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            error: null,
            manifestPath: null,
        });
        vi.mocked(api.validateMarkdown).mockResolvedValue({
            ok: true,
            errors: [],
            warnings: [],
        });
        vi.mocked(JobMonitorContext.useJobMonitor).mockReturnValue({
            jobMap: mockJobMap,
            jobs: [],
            recordings: [],
            recordingMap: {},
            eventLog: [],
            lastUpdateAt: null,
            logLedgerEntries: vi.fn(),
            registerJob: vi.fn(),
            registerRecording: mockRegisterRecording,
            refreshRecordings: vi.fn(),
            trackJob: vi.fn(),
            connectionState: 'connected',
            isPolling: false,
            lastError: null,
            liveUpdatesPaused: false,
            pauseLiveUpdates: vi.fn(),
            resumeLiveUpdates: vi.fn(),
        });
    });

    afterEach(() => {
        cleanup();
    });

    const renderWizard = (initialEntries = ['/wizard']) => {
        return render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={initialEntries}>
                    <AuthProvider>
                        <StudentSelectionProvider>
                            <JobSettingsProvider>
                                <JobMonitorContext.JobMonitorProvider>
                                    <WizardProvider>
                                        <AssignmentWizard />
                                    </WizardProvider>
                                </JobMonitorContext.JobMonitorProvider>
                            </JobSettingsProvider>
                        </StudentSelectionProvider>
                    </AuthProvider>
                </MemoryRouter>
            </QueryClientProvider>
        );
    };

    it('renders initial step and loads students', async () => {
        renderWizard();

        // Check header
        expect(screen.getByText('Build a new assignment')).not.toBeNull();

        // Check Step 1 content
        expect(screen.getByText('Select student and upload')).not.toBeNull();

        // Check students loaded
        await waitFor(() => {
            expect(screen.getByText('Alice')).not.toBeNull();
            expect(screen.getByText('Bob')).not.toBeNull();
        });
    });

    it('selects student and uploads file to advance', async () => {
        vi.mocked(api.uploadRecording).mockResolvedValue({
            recordingId: 'rec-123',
            transcriptId: null,
            status: 'ingested',
            error: null,
            source: 'upload',
            studentId: 's1',
            displayName: 'Test recording',
            durationSec: 120,
            channels: 1,
            bytes: 1024,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        renderWizard();

        // Wait for students
        await waitFor(() => screen.getByText('Alice'));

        // Select Alice
        fireEvent.click(screen.getByText('Alice'));

        // Upload file
        const uploadBtn = screen.getByText('Upload File');
        fireEvent.click(uploadBtn);

        // Verify upload called
        await waitFor(() => {
            expect(api.uploadRecording).toHaveBeenCalled();
        });

        // Check next button is enabled (Wait for "Recording ready")
        await waitFor(() => {
            expect(
                screen.getByText(/Recording ready\. Continue to review the transcript\./i)
            ).not.toBeNull();
        });

        // Click Continue
        const nextBtn = screen.getByText('Continue to transcript');
        fireEvent.click(nextBtn);

        // Should be on Step 2
        expect(screen.getByRole('heading', { name: 'Review transcript' })).not.toBeNull();
    });

    it('hydrates from deep link', async () => {
        vi.mocked(api.getJobStatus).mockResolvedValue({
            jobId: 'job-123',
            state: 'awaiting_approval',
            recordingId: 'rec-123',
            transcriptId: 'tx-123',
            draftId: 'draft-123',
            md: '/uploads/draft-123.md',
            promptPackageId: 'pp-123',
            preset: null,
            withTts: null,
            voiceId: null,
            upload: null,
            voiceAccent: null,
            forceTts: null,
            notionDatabase: null,
            publishTarget: 'notion',
            ttsStrategy: null,
            notionUrl: null,
            anytypeUrl: null,
            autoPublish: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            error: null,
            manifestPath: null,
        });

        vi.mocked(api.fetchDraft).mockResolvedValue({
            id: 'draft-123',
            promptPackageId: 'pp-123',
            studentId: 's1',
            storageUri: 'memory://draft',
            createdBy: 'u1',
            text: '# Draft Content',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        renderWizard(['/wizard?step=review&jobId=job-123']);

        // Should load job and jump to review step
        await waitFor(() => {
            expect(api.getJobStatus).toHaveBeenCalledWith('job-123');
        });

        // Verify we are on Step 4 (Review Draft)
        await waitFor(() => {
            expect(screen.getByText('Review draft')).not.toBeNull();
        });
    });
    it('shows completion panel after publishing', async () => {
        const publishedJob: JobStatus = {
            jobId: 'job-published',
            state: 'queued',
            recordingId: 'rec-1',
            transcriptId: 'tx-1',
            draftId: 'draft-1',
            md: '/draft.md',
            promptPackageId: 'pp-1',
            preset: 'b1-default',
            withTts: false,
            voiceId: null,
            upload: null,
            voiceAccent: null,
            forceTts: null,
            notionDatabase: null,
            publishTarget: 'notion',
            ttsStrategy: null,
            notionUrl: 'https://notion.so/page',
            anytypeUrl: null,
            autoPublish: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            error: null,
            manifestPath: null,
        };

        mockJobMap['job-published'] = publishedJob;
        vi.mocked(api.materializeDraft).mockResolvedValue({
            draftId: 'draft-1',
            jobId: 'job-published',
            mdPath: '/draft.md',
        });
        vi.mocked(api.getJobStatus).mockResolvedValue({
            ...publishedJob,
        });

        vi.mocked(api.approveJob).mockResolvedValue({
            ...publishedJob,
        });

        // Start at publish step
        renderWizard(['/wizard?step=publish&jobId=job-published']);

        // Wait for publish step
        const publishBtn = await screen.findByRole('button', { name: /^Publish job$/i });

        // Click Publish
        fireEvent.click(publishBtn);

        // Should see completion panel
        await waitFor(() => {
            expect(screen.getByText('Assignment published!')).not.toBeNull();
            expect(screen.getByText(/Open in Notion/i)).not.toBeNull();
        });

        // Check if we can start new
        const newBtn = screen.getByText('Start new assignment');
        fireEvent.click(newBtn);

        // Should return to step 1
        await waitFor(() => {
            expect(screen.getByText('Select student and upload')).not.toBeNull();
        });
    });
});
