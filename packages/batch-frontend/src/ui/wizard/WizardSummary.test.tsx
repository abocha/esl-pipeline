import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WizardSummary } from './WizardSummary';
import * as WizardContext from '../../context/WizardContext';
import * as StudentSelectionContext from '../../context/StudentSelectionContext';

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

describe('WizardSummary', () => {
    const defaultWizardState = {
        recordingId: null,
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        jobId: null,
        completedJobId: null,
        step: 'select-student',
    };

    const setup = (
        wizardStateOverride: Partial<typeof defaultWizardState> = {},
        selectedStudent: any = null
    ) => {
        vi.mocked(WizardContext.useWizard).mockReturnValue({
            state: { ...defaultWizardState, ...wizardStateOverride } as any,
            dispatch: vi.fn(),
        });

        vi.mocked(StudentSelectionContext.useStudentSelection).mockReturnValue({
            selectedStudent,
            setSelectedStudent: vi.fn(),
            updateSelectedStudent: vi.fn(),
        });

        return render(<WizardSummary />);
    };

    afterEach(() => {
        cleanup();
    });

    it('displays default empty states', () => {
        setup();
        expect(screen.getByText('Select student in Step 1')).not.toBeNull();
        expect(screen.getByText('Upload in Step 1')).not.toBeNull();
        expect(screen.getAllByText('Pending')).toHaveLength(2); // Prompt + Draft
    });

    it('displays student name when selected', () => {
        setup({}, { id: 's1', student: 'Alice' });
        expect(screen.getByText('Alice')).not.toBeNull();
        expect(screen.queryByText('Select student in Step 1')).toBeNull();
    });

    it('displays recording status when recordingId present', () => {
        setup({ recordingId: 'rec-1234567890' });
        expect(screen.getByText('rec-1234...')).not.toBeNull(); // Slice check
    });

    it('displays statuses as Created when IDs present', () => {
        setup({
            promptPackageId: 'pp-1',
            draftId: 'draft-1'
        });
        expect(screen.getAllByText('Created')).toHaveLength(2);
    });
});
