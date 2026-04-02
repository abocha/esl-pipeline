import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLEAN_TEMPLATE_STARTER_CONTENT,
  renderLoadedWorkspace,
  setupStudentWorkspaceTest,
} from './StudentWorkspace.test-harness';
import * as api from '../../utils/api';

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
      expect(api.updateStudentProfile).toHaveBeenCalledWith('student-default', {
        profileId: 'profile-alt.md',
      });
    });
  });

  it('saves template content from template gallery panel', async () => {
    const user = userEvent.setup();
    await renderLoadedWorkspace();

    const templateEditor = screen.getByPlaceholderText(
      /Select a template to edit/i,
    ) as HTMLTextAreaElement;
    await user.clear(templateEditor);
    await user.type(templateEditor, String.raw`HEADER\nUPDATED`);
    await user.click(screen.getByRole('button', { name: /Save Template Content/i }));

    await waitFor(() => {
      expect(api.upsertTemplateContent).toHaveBeenCalledWith(
        'template-default.md',
        expect.stringContaining(String.raw`HEADER\nUPDATED`),
      );
    });
  });

  it('creates template with a clean static scaffold', async () => {
    const user = userEvent.setup();
    vi.mocked(api.upsertTemplateContent).mockResolvedValue({
      id: 'hw/custom-template.md',
      label: 'Custom Template',
      content: CLEAN_TEMPLATE_STARTER_CONTENT,
      currentRevisionId: 'template-revision-3',
      updatedAt: '2026-02-07T12:00:00.000Z',
    });

    await renderLoadedWorkspace();

    await user.type(screen.getByLabelText(/New template ID/i), 'hw/custom-template.md');
    await user.click(screen.getByRole('button', { name: /Create Template/i }));

    await waitFor(() => {
      expect(api.upsertTemplateContent).toHaveBeenCalledWith(
        'hw/custom-template.md',
        CLEAN_TEMPLATE_STARTER_CONTENT,
      );
    });
  });
});
