import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  TemplateContentOption,
  TemplateContentResponse,
  TemplateRevisionSummaryResponse,
} from '../../utils/api';
import {
  activateTemplateRevision,
  deleteTemplateContent,
  getTemplateContent,
  listTemplateContents,
  listTemplateRevisions,
  restoreTemplateRevision,
  setDefaultTemplateContent,
  upsertTemplateContent,
} from '../../utils/api';

import './PromptTemplatesPage.css';

const REVISION_LIMIT = 25;
const CLEAN_TEMPLATE_STARTER_CONTENT = String.raw`## **System Prompt: ESL Homework Generator**

**Role & Scope**
You are an Expert ESL Content Assistant operating in a stateless backend runtime. Produce one complete homework assignment for one adult ESL student.

**Working Context Contract**
Treat the labeled context blocks appended after these instructions as the complete runtime context for this request.

**Context Priority Rules**
Use the runtime blocks in this order:
1. **[LATEST_TRANSCRIPT]**
2. **[TEACHER_NOTES]**
3. **[UNRESOLVED_ISSUES]**, **[RECENT_LESSON_MEMORY]**, **[RECENT_HOMEWORK_MEMORY]**
4. **[STUDENT_MEMORY_SNAPSHOT]**
5. **[FOUNDATIONAL_PROFILE]**

**Task-Specific Generation Rules**
1. Produce one coherent homework mission.
2. Use one primary input source.
3. If no input type is specified, default to \`generate\`.

**Output Formatting Rules**
- Return one Markdown code block with YAML front matter.
- Use the required section structure.
`;

type TemplateBusyState =
  | 'loading'
  | 'saving'
  | 'creating'
  | 'restoring'
  | 'activating'
  | 'defaulting'
  | 'archiving';

function formatDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function getRevisionLabel(revision: TemplateRevisionSummaryResponse): string {
  return revision.versionLabel || `v${revision.versionNumber ?? '?'}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const PromptTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<TemplateContentOption[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [currentTemplate, setCurrentTemplate] = useState<TemplateContentResponse | null>(null);
  const [editorText, setEditorText] = useState('');
  const [loadedText, setLoadedText] = useState('');
  const [revisions, setRevisions] = useState<TemplateRevisionSummaryResponse[]>([]);
  const [busy, setBusy] = useState<TemplateBusyState | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const templateDirty = useMemo(() => editorText !== loadedText, [editorText, loadedText]);
  const selectedTemplateLabel =
    templates.find((template) => template.id === selectedTemplateId)?.label ??
    currentTemplate?.label ??
    selectedTemplateId;
  const selectedTemplateIsDefault =
    Boolean(selectedTemplateId) && selectedTemplateId === defaultTemplateId;

  const confirmDiscardDirty = useCallback((): boolean => {
    if (!templateDirty) return true;
    return window.confirm('Discard unsaved template changes?');
  }, [templateDirty]);

  const loadTemplate = useCallback(
    async (templateId: string, options: { commitSelection?: boolean } = {}): Promise<boolean> => {
      const requestId = ++requestIdRef.current;
      if (!templateId) {
        setSelectedTemplateId('');
        setCurrentTemplate(null);
        setEditorText('');
        setLoadedText('');
        setRevisions([]);
        setError(null);
        return true;
      }

      setBusy('loading');
      setError(null);
      try {
        const [template, revisionList] = await Promise.all([
          getTemplateContent(templateId),
          listTemplateRevisions(templateId, { limit: REVISION_LIMIT, offset: 0, order: 'desc' }),
        ]);
        if (requestId !== requestIdRef.current) return false;
        if (options.commitSelection) {
          setSelectedTemplateId(templateId);
        }
        setCurrentTemplate(template);
        setEditorText(template.content ?? '');
        setLoadedText(template.content ?? '');
        setRevisions(revisionList.items ?? []);
        return true;
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return false;
        setError(getErrorMessage(loadError, 'Unable to load selected template.'));
        return false;
      } finally {
        if (requestId === requestIdRef.current) {
          setBusy(null);
        }
      }
    },
    [],
  );

  const loadTemplates = useCallback(
    async (
      preferredTemplateId?: string,
      options: { loadSelectedTemplate?: boolean } = { loadSelectedTemplate: true },
    ) => {
      setListLoading(true);
      setError(null);
      try {
        const response = await listTemplateContents();
        const nextTemplates = response.templates ?? [];
        setDefaultTemplateId(response.defaultTemplateId ?? null);
        setTemplates(nextTemplates);

        const nextSelected =
          preferredTemplateId &&
          nextTemplates.some((template) => template.id === preferredTemplateId)
            ? preferredTemplateId
            : (nextTemplates[0]?.id ?? preferredTemplateId ?? '');

        if (nextSelected && options.loadSelectedTemplate !== false) {
          await loadTemplate(nextSelected, { commitSelection: true });
        } else if (!nextSelected) {
          await loadTemplate('');
        } else {
          setSelectedTemplateId(nextSelected);
        }
      } catch (listError) {
        setError(getErrorMessage(listError, 'Unable to load prompt templates.'));
      } finally {
        setListLoading(false);
      }
    },
    [loadTemplate],
  );

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const handleSelectedTemplateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextTemplateId = event.target.value;
    if (nextTemplateId === selectedTemplateId) return;
    if (!confirmDiscardDirty()) {
      return;
    }

    setSuccess(null);
    void loadTemplate(nextTemplateId, { commitSelection: true });
  };

  const handleCreateTemplate = async () => {
    const templateId = newTemplateId.trim();
    if (!templateId) {
      setError('Template ID is required.');
      return;
    }
    if (!confirmDiscardDirty()) return;

    setBusy('creating');
    setError(null);
    setSuccess(null);
    try {
      const created = await upsertTemplateContent(templateId, CLEAN_TEMPLATE_STARTER_CONTENT);
      setNewTemplateId('');
      setSuccess(`Template ${created.id} created.`);
      await loadTemplates(created.id);
      await loadTemplate(created.id);
    } catch (createError) {
      setError(getErrorMessage(createError, 'Unable to create template.'));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplateId) {
      setError('Select a template before saving content.');
      return;
    }

    setBusy('saving');
    setError(null);
    setSuccess(null);
    try {
      const saved = await upsertTemplateContent(selectedTemplateId, editorText);
      setCurrentTemplate(saved);
      setEditorText(saved.content ?? '');
      setLoadedText(saved.content ?? '');
      const revisionList = await listTemplateRevisions(saved.id, {
        limit: REVISION_LIMIT,
        offset: 0,
        order: 'desc',
      });
      setRevisions(revisionList.items ?? []);
      setSuccess('Template saved.');
      await loadTemplates(saved.id, { loadSelectedTemplate: false });
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Unable to save template.'));
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!selectedTemplateId) return;
    if (!confirmDiscardDirty()) return;

    setBusy('restoring');
    setError(null);
    setSuccess(null);
    try {
      const restored = await restoreTemplateRevision(selectedTemplateId, revisionId);
      setCurrentTemplate(restored);
      setEditorText(restored.content ?? '');
      setLoadedText(restored.content ?? '');
      const revisionList = await listTemplateRevisions(restored.id, {
        limit: REVISION_LIMIT,
        offset: 0,
        order: 'desc',
      });
      setRevisions(revisionList.items ?? []);
      setSuccess('Template revision restored.');
      await loadTemplates(restored.id, { loadSelectedTemplate: false });
    } catch (restoreError) {
      setError(getErrorMessage(restoreError, 'Unable to restore template revision.'));
    } finally {
      setBusy(null);
    }
  };

  const handleActivateRevision = async (revisionId: string) => {
    if (!selectedTemplateId) return;
    if (!confirmDiscardDirty()) return;

    setBusy('activating');
    setError(null);
    setSuccess(null);
    try {
      await activateTemplateRevision(selectedTemplateId, revisionId);
      await loadTemplate(selectedTemplateId);
      setSuccess('Template revision activated.');
      await loadTemplates(selectedTemplateId, { loadSelectedTemplate: false });
    } catch (activateError) {
      setError(getErrorMessage(activateError, 'Unable to activate template revision.'));
    } finally {
      setBusy(null);
    }
  };

  const handleArchiveTemplate = async () => {
    if (!selectedTemplateId) return;
    if (!window.confirm(`Archive ${selectedTemplateId}? Revision history will be preserved.`)) {
      return;
    }

    const archivedId = selectedTemplateId;
    setBusy('archiving');
    setError(null);
    setSuccess(null);
    try {
      await deleteTemplateContent(archivedId);
      setSelectedTemplateId('');
      setCurrentTemplate(null);
      setEditorText('');
      setLoadedText('');
      setRevisions([]);
      setSuccess(`Template ${archivedId} archived.`);
      await loadTemplates();
    } catch (archiveError) {
      setError(getErrorMessage(archiveError, 'Unable to archive template.'));
    } finally {
      setBusy(null);
    }
  };

  const handleMakeDefaultTemplate = async () => {
    if (!selectedTemplateId) return;

    setBusy('defaulting');
    setError(null);
    setSuccess(null);
    try {
      const updated = await setDefaultTemplateContent(selectedTemplateId);
      setDefaultTemplateId(updated.id);
      setSuccess(`${updated.label} is now the default template.`);
      await loadTemplates(updated.id, { loadSelectedTemplate: false });
    } catch (defaultError) {
      setError(getErrorMessage(defaultError, 'Unable to update the default template.'));
    } finally {
      setBusy(null);
    }
  };

  const isBusy = busy !== null || listLoading;
  const hasTemplates = templates.length > 0;

  const handleRefresh = () => {
    if (!confirmDiscardDirty()) return;
    void loadTemplates(selectedTemplateId);
  };

  return (
    <section className="prompt-templates-page">
      <header className="prompt-templates-hero">
        <div>
          <span className="prompt-templates-kicker">Prompt Gallery</span>
          <h1>Prompt Templates</h1>
          <p>Manage the active homework-generation templates and their revision history.</p>
        </div>
        <button
          type="button"
          className="prompt-templates-secondary"
          onClick={handleRefresh}
          disabled={isBusy}
        >
          {listLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="prompt-templates-layout">
        <aside className="prompt-templates-sidebar" aria-label="Prompt template controls">
          <section className="prompt-templates-panel">
            <header>
              <span className="prompt-templates-section-label">Active Template</span>
              <h2>Selection</h2>
            </header>
            {hasTemplates ? (
              <label className="prompt-templates-field">
                Template
                <select
                  value={selectedTemplateId}
                  onChange={handleSelectedTemplateChange}
                  disabled={isBusy}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label} ({template.id})
                      {template.id === defaultTemplateId ? ' - default' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="prompt-templates-empty-small">
                <strong>No active prompt templates</strong>
                <span>Create one from the starter scaffold to unblock generation.</span>
              </div>
            )}
          </section>

          <section className="prompt-templates-panel">
            <header>
              <span className="prompt-templates-section-label">New Template</span>
              <h2>Create</h2>
            </header>
            <label className="prompt-templates-field">
              New template ID
              <input
                value={newTemplateId}
                onChange={(event) => setNewTemplateId(event.target.value)}
                placeholder="hw/custom-template.md"
                disabled={isBusy}
              />
            </label>
            <button
              type="button"
              className="prompt-templates-primary"
              onClick={() => void handleCreateTemplate()}
              disabled={isBusy || !newTemplateId.trim()}
            >
              {busy === 'creating' ? 'Creating...' : 'Create Template'}
            </button>
          </section>
        </aside>

        <main className="prompt-templates-editor-panel">
          <section className="prompt-templates-editor-card">
            <header className="prompt-templates-editor-header">
              <div>
                <span className="prompt-templates-section-label">Editor</span>
                <h2>{selectedTemplateLabel || 'No template selected'}</h2>
                <p>{currentTemplate?.id ?? 'Create or select a prompt template.'}</p>
              </div>
              <div className="prompt-templates-status-stack">
                {currentTemplate?.currentRevisionId ? (
                  <span className="prompt-templates-pill">Active revision</span>
                ) : null}
                {selectedTemplateIsDefault ? (
                  <span className="prompt-templates-pill success">Default</span>
                ) : null}
                {templateDirty ? (
                  <span className="prompt-templates-pill warning">Unsaved</span>
                ) : null}
              </div>
            </header>

            {error ? <p className="prompt-templates-alert error">{error}</p> : null}
            {success ? <p className="prompt-templates-alert success">{success}</p> : null}

            <label className="prompt-templates-editor-field">
              Template Content
              <textarea
                value={editorText}
                onChange={(event) => setEditorText(event.target.value)}
                rows={22}
                disabled={!selectedTemplateId || busy === 'loading'}
                placeholder="Select a template to edit."
              />
            </label>

            <div className="prompt-templates-actions">
              <button
                type="button"
                className="prompt-templates-primary"
                onClick={() => void handleSaveTemplate()}
                disabled={!selectedTemplateId || isBusy || !templateDirty}
              >
                {busy === 'saving' ? 'Saving...' : 'Save Template'}
              </button>
              <button
                type="button"
                className="prompt-templates-secondary danger"
                onClick={() => void handleArchiveTemplate()}
                disabled={!selectedTemplateId || isBusy}
              >
                {busy === 'archiving' ? 'Archiving...' : 'Archive Template'}
              </button>
              <button
                type="button"
                className="prompt-templates-secondary"
                onClick={() => void handleMakeDefaultTemplate()}
                disabled={!selectedTemplateId || isBusy || selectedTemplateIsDefault}
              >
                {busy === 'defaulting' ? 'Updating default...' : 'Make Default'}
              </button>
              {currentTemplate?.updatedAt ? (
                <span className="prompt-templates-muted">
                  Updated {formatDateTime(currentTemplate.updatedAt)}
                </span>
              ) : null}
            </div>
          </section>

          <section className="prompt-templates-revisions-card" aria-label="Template revisions">
            <header>
              <span className="prompt-templates-section-label">Version History</span>
              <h2>Revisions</h2>
            </header>
            {revisions.length > 0 ? (
              <div className="prompt-templates-revision-list">
                {revisions.map((revision) => {
                  const label = getRevisionLabel(revision);
                  return (
                    <article key={revision.id} className="prompt-templates-revision-row">
                      <div>
                        <strong>{label}</strong>
                        <span>
                          {revision.status ?? 'unknown'} · {revision.source}
                        </span>
                        <small>{formatDateTime(revision.createdAt)}</small>
                      </div>
                      <div className="prompt-templates-revision-actions">
                        <button
                          type="button"
                          className="prompt-templates-secondary"
                          onClick={() => void handleRestoreRevision(revision.id)}
                          disabled={isBusy}
                        >
                          Restore {label}
                        </button>
                        <button
                          type="button"
                          className="prompt-templates-secondary"
                          onClick={() => void handleActivateRevision(revision.id)}
                          disabled={isBusy}
                        >
                          Activate {label}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="prompt-templates-muted">No template revisions to show.</p>
            )}
          </section>
        </main>
      </div>
    </section>
  );
};
