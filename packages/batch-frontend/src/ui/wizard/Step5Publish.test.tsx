import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WizardProvider } from '../../context/WizardContext';
import { Step5Publish } from './Step5Publish';
import { StudentSelectionProvider } from '../../context/StudentSelectionContext';
import { JobSettingsProvider } from '../../context/JobSettingsContext';
import { AuthProvider } from '../../context/AuthContext';
import * as JobMonitorContext from '../../context/JobMonitorContext';
import * as api from '../../utils/api';
import type { JobState } from '../../utils/api';

// Mock JobMonitorContext
const mockLogLedgerEntries = vi.fn();
const mockRegisterJob = vi.fn();
const mockTrackJob = vi.fn();

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
        fetchJobOptions: vi.fn().mockResolvedValue({
            presets: ['b1-default'],
            voiceAccents: [],
            voices: [],
            notionDatabases: [{ id: 'default-b1', name: 'B1 Lessons' }],
            ttsStrategies: ['auto'],
        }),
        checkAuthStatus: vi.fn().mockResolvedValue({ isAuthenticated: true, user: { id: 'u1', email: 'test@example.com' } }),
        refreshToken: vi.fn().mockResolvedValue({
            user: { id: 'u1', email: 'test@example.com', role: 'user', isActive: true },
            accessToken: 'access-token',
        }),
        materializeDraft: vi.fn().mockResolvedValue({
            draftId: 'draft-1',
            jobId: 'job-1',
            mdPath: '/uploads/draft.md',
        }),
        approveJob: vi.fn().mockResolvedValue({
            jobId: 'job-1',
            state: 'queued',
        }),
    };
});

// Mock useNavigate
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

describe('Step5Publish Automation', () => {
    let queryClient: QueryClient;
    const defaultOverrides = {
        preset: 'b1-default',
        notionDatabase: 'default-b1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.mocked(JobMonitorContext.useJobMonitor).mockReturnValue({
            jobMap: {},
            jobs: [],
            recordings: [],
            recordingMap: {},
            eventLog: [],
            lastUpdateAt: null,
            logLedgerEntries: mockLogLedgerEntries,
            registerJob: mockRegisterJob,
            registerRecording: vi.fn(),
            refreshRecordings: vi.fn(),
            trackJob: mockTrackJob,
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

    const renderPublishStep = (props: {
        draftId?: string | null;
        jobId?: string | null;
        jobState?: JobState | null;
        jobMd?: string | null;
        overrides?: Record<string, unknown>;
        completedJobId?: string | null;
        transcriptSkipped?: boolean;
        autoPublishEnabled?: boolean;
    } = {}) => {
        const defaultProps = {
            draftId: 'draft-1',
            jobId: null,
            jobState: null,
            jobMd: null,
            overrides: defaultOverrides,
            completedJobId: null,
            transcriptSkipped: false,
            autoPublishEnabled: false,
            onAutomationChange: vi.fn(),
            onOverridesChange: vi.fn(),
            onJobPublished: vi.fn(),
            onStartNew: vi.fn(),
            onBack: vi.fn(),
            ...props,
        };

        return render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AuthProvider>
                        <StudentSelectionProvider>
                            <JobSettingsProvider>
                                <JobMonitorContext.JobMonitorProvider>
                                    <WizardProvider>
                                        <Step5Publish {...defaultProps} />
                                    </WizardProvider>
                                </JobMonitorContext.JobMonitorProvider>
                            </JobSettingsProvider>
                        </StudentSelectionProvider>
                    </AuthProvider>
                </MemoryRouter>
            </QueryClientProvider>
        );
    };

    it('renders automation card with auto-publish toggle', async () => {
        renderPublishStep();

        await waitFor(() => {
            expect(screen.getByText('Auto-publish')).not.toBeNull();
            expect(screen.getByText('Automation')).not.toBeNull();
        });

        // Toggle should be visible and enabled
        // Find the automation card and get its checkbox
        const automationCard = document.querySelector('.automation-card');
        expect(automationCard).not.toBeNull();
        const toggle = automationCard?.querySelector('input[type="checkbox"]');
        expect(toggle).not.toBeNull();
        expect(toggle).toHaveProperty('disabled', false);
    });

    it('shows ready message when auto-publish is available', async () => {
        renderPublishStep();

        await waitFor(() => {
            expect(screen.getByText(/Enable to auto-publish when ready/i)).not.toBeNull();
        });
    });

    it('displays automation toggle in enabled state', async () => {
        renderPublishStep({ autoPublishEnabled: false });

        await waitFor(() => {
            const automationCard = document.querySelector('.automation-card');
            const toggle = automationCard?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            expect(toggle).not.toBeNull();
            expect(toggle?.checked).toBe(false);
            expect(toggle?.disabled).toBe(false);
        });
    });

    it('renders publish button and job settings', async () => {
        renderPublishStep();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Publish job/i })).not.toBeNull();
            expect(screen.getByText('Job settings')).not.toBeNull();
        });
    });

    it('shows transcript skipped warning when applicable', async () => {
        renderPublishStep({ transcriptSkipped: true });

        await waitFor(() => {
            expect(screen.getByText('Publish warnings')).not.toBeNull();
            expect(screen.getByText(/Transcript review was skipped/i)).not.toBeNull();
        });
    });
});
