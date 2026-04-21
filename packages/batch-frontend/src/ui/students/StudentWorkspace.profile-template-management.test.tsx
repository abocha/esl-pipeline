import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CLEAN_TEMPLATE_STARTER_CONTENT,
  renderLoadedWorkspace,
  setupStudentWorkspaceTest,
  studentWorkspaceApiMocks,
} from './StudentWorkspace.test-harness';

describe('StudentWorkspace profile and template management', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('updates student profile binding', async () => {
    const user = userEvent.setup();
    await renderLoadedWorkspace();

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Bound profile/i }),
      'profile-alt.md',
    );
    await user.click(screen.getByRole('button', { name: /Save Student Binding/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.updateStudentProfile).toHaveBeenCalledWith(
        'student-default',
        {
          profileId: 'profile-alt.md',
        },
      );
    });
  });

  it('saves a structured foundational profile draft from the learning form', async () => {
    const user = userEvent.setup();
    await renderLoadedWorkspace();

    await user.clear(screen.getByLabelText(/Current level/i));
    await user.type(screen.getByLabelText(/Current level/i), 'B2');
    await user.clear(screen.getByLabelText(/Primary goals/i));
    await user.type(screen.getByLabelText(/Primary goals/i), 'Lead project updates confidently.');
    await user.click(screen.getByRole('button', { name: /Save Profile Draft/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.saveProfileDraftRevision).toHaveBeenCalledWith(
        'profile-default.md',
        {
          structuredContent: {
            schemaVersion: 'foundational_profile_v1',
            overallLevel: 'B2',
            primaryGoals: ['Lead project updates confidently.'],
            communicationContexts: ['Client calls'],
            interestsAndUsefulThemes: ['Travel'],
            stableStrengths: ['High motivation'],
            persistentChallenges: ['Article usage'],
            studyPreferences: ['Prefers structured explanations'],
            durableConstraints: ['Short homework windows'],
            teacherNotes: 'Responds well to practical scenarios.',
          },
        },
      );
    });
  });

  it('saves template content from template gallery panel', async () => {
    const user = userEvent.setup();
    await renderLoadedWorkspace();

    const templateEditor = screen.getByPlaceholderText(
      /Select a template to edit/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(templateEditor, { target: { value: String.raw`HEADER\nUPDATED` } });
    await user.click(screen.getByRole('button', { name: /Save Template Content/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.upsertTemplateContent).toHaveBeenCalledWith(
        'template-default.md',
        expect.stringContaining(String.raw`HEADER\nUPDATED`),
      );
    });
  });

  it('creates template with a clean static scaffold', async () => {
    const user = userEvent.setup();
    studentWorkspaceApiMocks.upsertTemplateContent.mockResolvedValue({
      id: 'hw/custom-template.md',
      label: 'Custom Template',
      content: CLEAN_TEMPLATE_STARTER_CONTENT,
      currentRevisionId: 'template-revision-3',
      updatedAt: '2026-02-07T12:00:00.000Z',
    });

    await renderLoadedWorkspace();

    fireEvent.change(screen.getByLabelText(/New template ID/i), {
      target: { value: 'hw/custom-template.md' },
    });
    await user.click(screen.getByRole('button', { name: /Create Template/i }));

    await waitFor(() => {
      expect(studentWorkspaceApiMocks.upsertTemplateContent).toHaveBeenCalledWith(
        'hw/custom-template.md',
        CLEAN_TEMPLATE_STARTER_CONTENT,
      );
    });
  });
});
