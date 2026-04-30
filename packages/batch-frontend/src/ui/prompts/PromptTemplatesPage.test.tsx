import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptTemplatesPage } from './PromptTemplatesPage';

const apiMocks = vi.hoisted(() => ({
  activateTemplateRevision: vi.fn(),
  deleteTemplateContent: vi.fn(),
  getTemplateContent: vi.fn(),
  listTemplateContents: vi.fn(),
  listTemplateRevisions: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  upsertTemplateContent: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

const STARTER_TEMPLATE_SNIPPET = 'Expert ESL Content Assistant';
const now = '2026-05-01T09:00:00.000Z';

function seedPromptTemplateMocks() {
  apiMocks.listTemplateContents.mockResolvedValue({
    templates: [
      { id: 'hw/default.md', label: 'Default Homework' },
      { id: 'hw/alternate.md', label: 'Alternate Homework' },
    ],
  });
  apiMocks.getTemplateContent.mockImplementation(async (templateId: string) => ({
    id: templateId,
    label: templateId === 'hw/alternate.md' ? 'Alternate Homework' : 'Default Homework',
    content: templateId === 'hw/alternate.md' ? 'ALTERNATE TEMPLATE' : 'DEFAULT TEMPLATE',
    currentRevisionId: templateId === 'hw/alternate.md' ? 'revision-2' : 'revision-1',
    updatedAt: now,
  }));
  apiMocks.listTemplateRevisions.mockImplementation(async (templateId: string) => ({
    items: [
      {
        id: templateId === 'hw/alternate.md' ? 'revision-2' : 'revision-1',
        templateId,
        contentHash: 'hash-1',
        source: 'create',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: now,
        deprecatedAt: null,
        createdAt: now,
        createdBy: 'user-1',
        restoredFromRevisionId: null,
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
    order: 'desc',
  }));
  apiMocks.upsertTemplateContent.mockImplementation(
    async (templateId: string, content: string) => ({
      id: templateId,
      label: templateId,
      content,
      currentRevisionId: 'revision-saved',
      updatedAt: now,
    }),
  );
  apiMocks.restoreTemplateRevision.mockResolvedValue({
    id: 'hw/default.md',
    label: 'Default Homework',
    content: 'RESTORED TEMPLATE',
    currentRevisionId: 'revision-restored',
    updatedAt: now,
  });
  apiMocks.activateTemplateRevision.mockResolvedValue({
    id: 'revision-1',
    templateId: 'hw/default.md',
    contentHash: 'hash-1',
    source: 'create',
    status: 'active',
    versionNumber: 1,
    versionLabel: 'v1',
    activatedAt: now,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'user-1',
    restoredFromRevisionId: null,
    content: 'DEFAULT TEMPLATE',
  });
  apiMocks.deleteTemplateContent.mockResolvedValue(undefined);
}

function renderPromptTemplatesPage() {
  return render(
    <MemoryRouter>
      <PromptTemplatesPage />
    </MemoryRouter>,
  );
}

describe('PromptTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedPromptTemplateMocks();
  });

  it('loads active templates, selected content, and revision history', async () => {
    renderPromptTemplatesPage();

    expect(await screen.findByRole('heading', { name: /Prompt Templates/i })).toBeTruthy();
    expect(await screen.findByDisplayValue('DEFAULT TEMPLATE')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /Template/i }) as HTMLSelectElement).value).toBe(
      'hw/default.md',
    );
    expect(screen.getByText('v1')).toBeTruthy();
    expect(apiMocks.getTemplateContent).toHaveBeenCalledWith('hw/default.md');
    expect(apiMocks.listTemplateRevisions).toHaveBeenCalledWith('hw/default.md', {
      limit: 25,
      offset: 0,
      order: 'desc',
    });
  });

  it('saves edited template content and refreshes revision history', async () => {
    const user = userEvent.setup();
    renderPromptTemplatesPage();

    const editor = (await screen.findByLabelText(/Template Content/i)) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'UPDATED TEMPLATE');
    await user.click(screen.getByRole('button', { name: /Save Template/i }));

    await waitFor(() => {
      expect(apiMocks.upsertTemplateContent).toHaveBeenCalledWith(
        'hw/default.md',
        'UPDATED TEMPLATE',
      );
    });
    expect(screen.getByText(/Template saved/i)).toBeTruthy();
  });

  it('creates a template from the clean starter scaffold and selects it', async () => {
    const user = userEvent.setup();
    renderPromptTemplatesPage();

    await user.type(await screen.findByLabelText(/New template ID/i), 'hw/custom.md');
    await user.click(screen.getByRole('button', { name: /Create Template/i }));

    await waitFor(() => {
      expect(apiMocks.upsertTemplateContent).toHaveBeenCalledWith(
        'hw/custom.md',
        expect.stringContaining(STARTER_TEMPLATE_SNIPPET),
      );
    });
    expect(apiMocks.getTemplateContent).toHaveBeenLastCalledWith('hw/custom.md');
  });

  it('restores and activates revisions from the revision list', async () => {
    const user = userEvent.setup();
    renderPromptTemplatesPage();

    const revisionList = await screen.findByLabelText(/Template revisions/i);
    await user.click(within(revisionList).getByRole('button', { name: /Restore v1/i }));

    await waitFor(() => {
      expect(apiMocks.restoreTemplateRevision).toHaveBeenCalledWith('hw/default.md', 'revision-1');
    });
    expect(screen.getByDisplayValue('RESTORED TEMPLATE')).toBeTruthy();

    await user.click(within(revisionList).getByRole('button', { name: /Activate v1/i }));

    await waitFor(() => {
      expect(apiMocks.activateTemplateRevision).toHaveBeenCalledWith('hw/default.md', 'revision-1');
    });
  });

  it('requires confirmation before archiving a template and clears the editor after archive', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiMocks.listTemplateContents
      .mockResolvedValueOnce({
        templates: [
          { id: 'hw/default.md', label: 'Default Homework' },
          { id: 'hw/alternate.md', label: 'Alternate Homework' },
        ],
      })
      .mockResolvedValueOnce({ templates: [] });

    renderPromptTemplatesPage();
    await screen.findByDisplayValue('DEFAULT TEMPLATE');
    await user.click(screen.getByRole('button', { name: /Archive Template/i }));

    await waitFor(() => {
      expect(apiMocks.deleteTemplateContent).toHaveBeenCalledWith('hw/default.md');
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText(/No active prompt templates/i)).toBeTruthy();

    confirmSpy.mockRestore();
  });

  it('keeps unsaved edits when template switching is cancelled', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPromptTemplatesPage();

    const editor = (await screen.findByLabelText(/Template Content/i)) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'UNSAVED TEMPLATE');
    fireEvent.change(screen.getByRole('combobox', { name: /Template/i }), {
      target: { value: 'hw/alternate.md' },
    });

    expect((screen.getByRole('combobox', { name: /Template/i }) as HTMLSelectElement).value).toBe(
      'hw/default.md',
    );
    expect(screen.getByDisplayValue('UNSAVED TEMPLATE')).toBeTruthy();
    expect(apiMocks.getTemplateContent).not.toHaveBeenCalledWith('hw/alternate.md');

    confirmSpy.mockRestore();
  });

  it('shows loading errors without clearing the existing editor content', async () => {
    const user = userEvent.setup();
    renderPromptTemplatesPage();
    await screen.findByDisplayValue('DEFAULT TEMPLATE');

    apiMocks.getTemplateContent.mockRejectedValueOnce(new Error('Template unavailable'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByRole('combobox', { name: /Template/i }), {
      target: { value: 'hw/alternate.md' },
    });

    expect(await screen.findByText(/Template unavailable/i)).toBeTruthy();
    expect(screen.getByDisplayValue('DEFAULT TEMPLATE')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(apiMocks.listTemplateContents).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('does not save stale editor content into a template that failed to load', async () => {
    const user = userEvent.setup();
    renderPromptTemplatesPage();
    await screen.findByDisplayValue('DEFAULT TEMPLATE');

    apiMocks.getTemplateContent.mockRejectedValueOnce(new Error('Template unavailable'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByRole('combobox', { name: /Template/i }), {
      target: { value: 'hw/alternate.md' },
    });

    expect(await screen.findByText(/Template unavailable/i)).toBeTruthy();
    expect((screen.getByRole('combobox', { name: /Template/i }) as HTMLSelectElement).value).toBe(
      'hw/default.md',
    );

    const editor = screen.getByLabelText(/Template Content/i) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'STALE EDIT');
    await user.click(screen.getByRole('button', { name: /Save Template/i }));

    await waitFor(() => {
      expect(apiMocks.upsertTemplateContent).toHaveBeenCalledWith('hw/default.md', 'STALE EDIT');
    });
    expect(apiMocks.upsertTemplateContent).not.toHaveBeenCalledWith(
      'hw/alternate.md',
      'STALE EDIT',
    );

    confirmSpy.mockRestore();
  });

  it('keeps unsaved edits when refresh is cancelled', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPromptTemplatesPage();

    const editor = (await screen.findByLabelText(/Template Content/i)) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'UNSAVED BEFORE REFRESH');
    await user.click(screen.getByRole('button', { name: /Refresh/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByDisplayValue('UNSAVED BEFORE REFRESH')).toBeTruthy();
    expect(apiMocks.listTemplateContents).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('does not create and switch templates when unsaved edits are not discarded', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPromptTemplatesPage();

    const editor = (await screen.findByLabelText(/Template Content/i)) as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, 'UNSAVED BEFORE CREATE');
    await user.type(screen.getByLabelText(/New template ID/i), 'hw/custom.md');
    await user.click(screen.getByRole('button', { name: /Create Template/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(apiMocks.upsertTemplateContent).not.toHaveBeenCalledWith(
      'hw/custom.md',
      expect.any(String),
    );
    expect(screen.getByDisplayValue('UNSAVED BEFORE CREATE')).toBeTruthy();

    confirmSpy.mockRestore();
  });
});
