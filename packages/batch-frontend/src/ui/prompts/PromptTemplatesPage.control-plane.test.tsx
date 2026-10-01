import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TemplateControlPlaneDto } from '@esl-pipeline/contracts';

import { PromptTemplatesPage } from './PromptTemplatesPage';

const api = vi.hoisted(() => ({
  listTemplateControlPlane: vi.fn(),
  listTemplateRevisions: vi.fn(),
  activateTemplateRevision: vi.fn(),
  getTemplateRevision: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  setDefaultTemplateContent: vi.fn(),
  deleteTemplateContent: vi.fn(),
  upsertTemplateContent: vi.fn(),
}));
vi.mock('../../utils/api', () => api);
let state: TemplateControlPlaneDto;
beforeEach(() => {
  vi.clearAllMocks();
  const metadata = {
    status: 'active' as const,
    source: 'update' as const,
    createdAt: '2026-09-30T00:00:00Z',
    activatedAt: '2026-09-30T01:00:00Z',
    restoredFromRevisionId: null,
  };
  state = {
    templateId: 'template.md',
    label: 'Homework',
    databasePresent: true,
    active: {
      ...metadata,
      id: 'old',
      versionLabel: 'v14',
      contentHash: 'old-hash',
      content: 'Header\nOld instruction\nFooter',
    },
    shipped: {
      contentHash: 'shipped-hash',
      content: 'Header\nNew instruction\nFooter',
      imported: true,
      matchingRevision: {
        ...metadata,
        status: 'draft',
        activatedAt: null,
        id: 'shipped',
        versionLabel: 'v17',
        contentHash: 'shipped-hash',
        content: 'Header\nNew instruction\nFooter',
      },
    },
    drift: 'update_available',
  };
  api.listTemplateControlPlane.mockImplementation(async () => ({
    items: [state],
    defaultTemplateId: 'template.md',
  }));
  api.listTemplateRevisions.mockImplementation(async () => ({
    items: [state.shipped?.matchingRevision, state.active].filter(Boolean),
    total: 2,
  }));
  api.activateTemplateRevision.mockImplementation(async () => {
    state = {
      ...state,
      active: { ...state.shipped?.matchingRevision, status: 'active' } as NonNullable<
        TemplateControlPlaneDto['active']
      >,
      drift: 'in_sync',
    };
  });
});

describe('prompt control plane workflow', () => {
  it('shows release drift and a readable ordered diff, then refreshes after explicit activation', async () => {
    const user = userEvent.setup();
    const { container } = render(<PromptTemplatesPage />);
    expect(await screen.findByText('Update available')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active v14' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Shipped v17' })).toBeTruthy();
    expect(screen.getByLabelText('Active vs shipped diff').textContent).toContain(
      '− Old instruction',
    );
    expect(screen.getByLabelText('Active vs shipped diff').textContent).toContain(
      '+ New instruction',
    );
    expect(container.querySelector('.prompt-control-editor')?.hasAttribute('open')).toBe(false);
    expect(api.activateTemplateRevision).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Activate shipped v17' }));
    await waitFor(() =>
      expect(api.activateTemplateRevision).toHaveBeenCalledWith('template.md', 'shipped'),
    );
    expect(await screen.findByText('Up to date')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active v17' })).toBeTruthy();
  });

  it('shows unimported shipped content without offering activation or creating revisions', async () => {
    state.shipped = {
      content: 'New content',
      contentHash: 'new-hash',
      matchingRevision: null,
      imported: false,
    };
    state.databasePresent = false;
    state.active = null;
    state.drift = 'shipped_not_imported';
    render(<PromptTemplatesPage />);
    expect(await screen.findByText('Shipped content not imported')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active None' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Activate shipped/ })).toBeNull();
    expect(api.listTemplateRevisions).not.toHaveBeenCalled();
    expect(api.activateTemplateRevision).not.toHaveBeenCalled();
    expect(api.upsertTemplateContent).not.toHaveBeenCalled();
  });

  it('inspects historical content against active content without changing activation', async () => {
    const user = userEvent.setup();
    api.getTemplateRevision.mockResolvedValue({
      id: 'shipped',
      versionLabel: 'v17',
      content: 'Historical content',
    });
    render(<PromptTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Inspect v17' }));
    expect(await screen.findByLabelText('Active vs v17 diff')).toBeTruthy();
    expect(api.getTemplateRevision).toHaveBeenCalledWith('template.md', 'shipped');
    expect(api.activateTemplateRevision).not.toHaveBeenCalled();
  });
});
