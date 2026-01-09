import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WizardProvider } from '../../context/WizardContext';
import { AssignmentWizard } from './AssignmentWizard';
import * as api from '../../utils/api';
import { StudentSelectionProvider } from '../../context/StudentSelectionContext';
import { JobSettingsProvider } from '../../context/JobSettingsContext';
import { AuthProvider } from '../../context/AuthContext';
import * as JobMonitorContext from '../../context/JobMonitorContext';

// Mock JobMonitorContext
const mockRegisterRecording = vi.fn();
const mockJobMap = {};
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
        getJobStatus: vi.fn(),
        fetchDraft: vi.fn(),
        fetchJobOptions: vi.fn().mockResolvedValue({
            presets: ['b1-default'],
            voiceAccents: [],
            voices: [],
            notionDatabases: [],
            ttsStrategies: ['auto'],
        }), // Mock for JobSettings
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

describe('AssignmentWizard Integration', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
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
        vi.mocked(JobMonitorContext.useJobMonitor).mockReturnValue({
            jobMap: mockJobMap,
            jobs: [],
            recordings: [],
            recordingMap: {},
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

    it.skip('selects student and uploads file to advance', async () => {
        vi.mocked(api.uploadRecording).mockResolvedValue({
            recordingId: 'rec-123',
            transcriptId: null,
            status: 'ingested',
            studentId: 's1',
        } as unknown as api.RecordingListItem);

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
            expect(screen.getByText(/Recording ready/i)).not.toBeNull();
        });

        // Click Continue
        const nextBtn = screen.getByText('Continue to transcript');
        fireEvent.click(nextBtn);

        // Should be on Step 2
        expect(screen.getByText('Review transcript')).not.toBeNull();
    });

    it.skip('hydrates from deep link', async () => {
        vi.mocked(api.getJobStatus).mockResolvedValue({
            jobId: 'job-123',
            state: 'awaiting_approval',
            recordingId: 'rec-123',
            transcriptId: 'tx-123',
            draftId: 'draft-123',
            draftText: '# Draft Content', // Note: draftText is not on JobStatusDto
        } as unknown as api.JobStatus);

        vi.mocked(api.fetchDraft).mockResolvedValue({
            id: 'draft-123',
            text: '# Draft Content',
        } as unknown as api.DraftResponse);

        renderWizard(['/wizard?step=review&jobId=job-123']);

        // Should load job and jump to review step
        await waitFor(() => {
            expect(api.getJobStatus).toHaveBeenCalledWith('job-123');
        });

        // Verify we are on Step 4 (Review Draft)
        await waitFor(() => {
            expect(screen.getByText('Review and edit draft')).not.toBeNull();
        });
    });
});
