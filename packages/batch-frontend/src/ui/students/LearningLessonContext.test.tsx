import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import { LearningLessonContext } from './LearningLessonContext';

vi.mock('../../utils/api', () => ({
  fetchRecordingTranscript: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  listUserJobs: vi.fn(),
}));
vi.mock('../../context/WorkspaceTimezoneContext', () => ({
  useWorkspaceTimezone: () => 'Asia/Bangkok',
}));
const lesson = {
  id: 'memory-1',
  recordingId: 'recording-1',
  transcriptId: 'transcript-1',
  lessonTitle: 'A change of plans',
  sourceContentHash: 'a'.repeat(64),
  assignmentSessionId: 'session-1',
};
describe('Learning lesson context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValue({
      nextLesson: null,
    } as api.StudentScheduleBillingSurface);
    vi.mocked(api.listUserJobs).mockResolvedValue({ jobs: [], total: 0, limit: 1, offset: 0 });
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValue({
      transcriptId: 'transcript-1',
      recordingId: 'recording-1',
      contentHash: 'a'.repeat(64),
      text: 'We discussed a change of plans.',
    } as api.RecordingTranscriptResponse);
  });
  it('waits for the schedule before showing either the next lesson or a schedule link', async () => {
    let resolve!: (value: api.StudentScheduleBillingSurface) => void;
    vi.mocked(api.getStudentScheduleBillingSurface).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <MemoryRouter>
        <LearningLessonContext studentId="student-1" latestLesson={null} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status', { name: 'Loading next lesson' })).toBeTruthy();
    expect(screen.queryByText(/^Next lesson$/)).toBeNull();
    expect(screen.queryByText('No upcoming lesson')).toBeNull();
    expect(screen.queryByRole('link', { name: /schedule/i })).toBeNull();

    await act(async () =>
      resolve({
        nextLesson: { startsAt: '2026-11-05T10:00:00Z' },
      } as api.StudentScheduleBillingSurface),
    );
    expect(screen.getByText('November 5 at 05:00 PM')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View schedule' }).getAttribute('href')).toBe(
      '/students/student-1/schedule',
    );
  });
  it('opens exact lesson work and lazily reads its transcript, keeping current edits distinct from the saved lesson summary', async () => {
    render(
      <MemoryRouter>
        <LearningLessonContext studentId="student-1" latestLesson={lesson} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No upcoming lesson')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Schedule lesson' }).getAttribute('href')).toBe(
      '/students/student-1/schedule#teaching-calendar',
    );
    expect(screen.getByRole('link', { name: 'Open lesson work' }).getAttribute('href')).toBe(
      '/?sessionId=session-1',
    );
    expect(api.fetchRecordingTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('A change of plans'));
    expect(await screen.findByText('We discussed a change of plans.')).toBeTruthy();
    expect(screen.getByText('Lesson transcript')).toBeTruthy();
    expect(api.fetchRecordingTranscript).toHaveBeenCalledWith('recording-1');
  });
  it('does not attribute a replacement transcript to the saved lesson', async () => {
    vi.mocked(api.fetchRecordingTranscript).mockResolvedValue({
      transcriptId: 'replacement',
      text: 'Different lesson text',
    } as api.RecordingTranscriptResponse);
    render(
      <MemoryRouter>
        <LearningLessonContext studentId="student-1" latestLesson={lesson} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('A change of plans'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Different lesson text')).toBeNull();
  });
  it('keeps schedule and assignment retrieval failures separate and retries without hiding retained lesson context', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getStudentScheduleBillingSurface).mockRejectedValueOnce(new Error('Offline'));
    vi.mocked(api.listUserJobs).mockRejectedValueOnce(new Error('Offline'));
    render(
      <MemoryRouter>
        <LearningLessonContext
          studentId="student-1"
          latestLesson={{ ...lesson, assignmentSessionId: null }}
        />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry next lesson' }));
    await user.click(await screen.findByRole('button', { name: 'Retry assignment link' }));
    await waitFor(() => expect(screen.queryByText('Assignment unavailable.')).toBeNull());
    expect(await screen.findByText('No upcoming lesson')).toBeTruthy();
    expect(screen.getByText('A change of plans')).toBeTruthy();
  });
  it('ignores an earlier learner response after a learner switch', async () => {
    let resolve!: (value: api.StudentScheduleBillingSurface) => void;
    vi.mocked(api.getStudentScheduleBillingSurface).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(
      <MemoryRouter>
        <LearningLessonContext key="old" studentId="old" latestLesson={lesson} />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <LearningLessonContext key="new" studentId="new" latestLesson={null} />
      </MemoryRouter>,
    );
    await screen.findByText('No upcoming lesson');
    await act(async () =>
      resolve({
        nextLesson: { startsAt: '2026-11-05T10:00:00Z' },
      } as api.StudentScheduleBillingSurface),
    );
    expect(screen.queryByText('November 5 at 05:00 PM')).toBeNull();
    expect(screen.queryByText('A change of plans')).toBeNull();
  });
});
