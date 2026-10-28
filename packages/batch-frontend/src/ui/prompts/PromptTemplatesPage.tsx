import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TemplateControlPlaneDto } from '@esl-pipeline/contracts';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import type {
  TemplateContentOption,
  TemplateContentResponse,
  TemplateRevisionSummaryResponse,
} from '../../utils/api';
import {
  activateTemplateRevision,
  deleteTemplateContent,
  getTemplateRevision,
  importAndActivateShippedTemplate,
  listTemplateControlPlane,
  listTemplateRevisions,
  restoreTemplateRevision,
  setDefaultTemplateContent,
  upsertTemplateContent,
} from '../../utils/api';
import { formatTutorTime } from '../../utils/tutor-time';
import { TemplateContentComparison, TemplateControlPlane } from './TemplateControlPlane';
import './PromptTemplatesPage.css';

const REVISION_LIMIT = 25;
// Exact persisted legacy ID (spaces, not underscores). Keep its revisions in the DB.
const RETIRED_MARKDOWN_TEMPLATE_ID = 'hw prompt markdown block.md';
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
- Return an AssignmentV1 object matching the supplied Structured Outputs JSON schema.
- Use typed fields and preserve the learner and source context.
`;

type TemplateBusyState =
  | 'loading'
  | 'saving'
  | 'creating'
  | 'restoring'
  | 'activating'
  | 'defaulting'
  | 'archiving';

function getRevisionLabel(revision: TemplateRevisionSummaryResponse): string {
  return revision.versionLabel || `v${revision.versionNumber ?? '?'}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const PromptTemplatesPage: React.FC = () => {
  const timezone = useWorkspaceTimezone();
  const formatDateTime = (value?: string | null) => formatTutorTime(value, timezone);
  const [templates, setTemplates] = useState<TemplateContentOption[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [currentTemplate, setCurrentTemplate] = useState<TemplateContentResponse | null>(null);
  const [controlPlane, setControlPlane] = useState<TemplateControlPlaneDto | null>(null);
  const [inspectedRevision, setInspectedRevision] = useState<{
    id: string;
    content: string;
    label: string;
  } | null>(null);
  const inspectionRequestRef = useRef(0);
  const [editorText, setEditorText] = useState('');
  const [loadedText, setLoadedText] = useState('');
  const [revisions, setRevisions] = useState<TemplateRevisionSummaryResponse[]>([]);
  const [revisionTotal, setRevisionTotal] = useState(0);
  const [busy, setBusy] = useState<TemplateBusyState | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
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
    async (
      templateId: string,
      options: { commitSelection?: boolean; state?: TemplateControlPlaneDto } = {},
    ): Promise<boolean> => {
      const requestId = ++requestIdRef.current;
      inspectionRequestRef.current++;
      setInspectedRevision(null);
      setControlPlane(null);
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
        const state =
          options.state ??
          (await listTemplateControlPlane()).items.find((item) => item.templateId === templateId);
        if (!state) throw new Error('Template is no longer available. Refresh the catalog.');
        const revisionList = state.databasePresent
          ? await listTemplateRevisions(templateId, {
              limit: REVISION_LIMIT,
              offset: 0,
              order: 'desc',
            })
          : { items: [], total: 0 };
        const template: TemplateContentResponse = {
          id: state.templateId,
          label: state.label,
          content: state.active?.content ?? '',
          currentRevisionId: state.active?.id ?? null,
          updatedAt: state.active?.createdAt ?? null,
        };
        if (requestId !== requestIdRef.current) return false;
        if (options.commitSelection) {
          setSelectedTemplateId(templateId);
        }
        setControlPlane(state);
        setCurrentTemplate(template);
        setEditorText(template.content ?? '');
        setLoadedText(template.content ?? '');
        setRevisions(revisionList.items ?? []);
        setRevisionTotal(revisionList.total);
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
      setListError(null);
      setError(null);
      try {
        const response = await listTemplateControlPlane();
        const nextTemplates = response.items
          .filter(
            (item) =>
              item.templateId !== RETIRED_MARKDOWN_TEMPLATE_ID ||
              item.templateId === response.defaultTemplateId ||
              item.active !== null ||
              item.shipped !== null,
          )
          .map((item) => ({
            id: item.templateId,
            label: item.label,
          }));
        setDefaultTemplateId(response.defaultTemplateId ?? null);
        setTemplates(nextTemplates);

        const nextSelected =
          [preferredTemplateId, response.defaultTemplateId].find(
            (id) => id && nextTemplates.some((template) => template.id === id),
          ) ??
          nextTemplates[0]?.id ??
          '';

        if (nextSelected && options.loadSelectedTemplate !== false) {
          await loadTemplate(nextSelected, {
            commitSelection: true,
            state: response.items.find((item) => item.templateId === nextSelected),
          });
        } else if (!nextSelected) {
          await loadTemplate('');
        } else {
          setSelectedTemplateId(nextSelected);
        }
      } catch (listError) {
        const message = getErrorMessage(listError, 'Unable to load prompt templates.');
        setListError(message);
        setError(message);
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
      await loadTemplate(saved.id);
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
      await loadTemplate(restored.id);
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

  const handleImportAndActivate = async () => {
    if (!selectedTemplateId || isBusy) return;
    if (!confirmDiscardDirty()) return;
    setBusy('activating');
    setError(null);
    setSuccess(null);
    try {
      await importAndActivateShippedTemplate(selectedTemplateId);
    } catch (importError) {
      const message = getErrorMessage(importError, 'Import and activation could not be completed.');
      const refreshed = await loadTemplate(selectedTemplateId);
      setError(
        `${message}${refreshed ? '' : ' Persisted state could not be refreshed. Reload the page before retrying.'}`,
      );
      setBusy(null);
      return;
    }
    const refreshed = await loadTemplate(selectedTemplateId);
    if (refreshed) setSuccess('Shipped template imported and activated.');
    else
      setError(
        'Import and activation completed, but persisted state could not be refreshed. Reload the page.',
      );
    setBusy(null);
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

  const handleOlderRevisions = async () => {
    const templateId = selectedTemplateId;
    const requestId = requestIdRef.current;
    setBusy('loading');
    try {
      const page = await listTemplateRevisions(templateId, {
        limit: REVISION_LIMIT,
        offset: revisions.length,
        order: 'desc',
      });
      if (requestId === requestIdRef.current) {
        setRevisions((current) => [
          ...current,
          ...page.items.filter((item) => !current.some((revision) => revision.id === item.id)),
        ]);
        setRevisionTotal(page.total);
      }
    } catch (error) {
      if (requestId === requestIdRef.current)
        setError(getErrorMessage(error, 'Unable to load older revisions.'));
    } finally {
      if (requestId === requestIdRef.current) setBusy(null);
    }
  };

  const handleInspectRevision = async (revisionId: string) => {
    const requestId = ++inspectionRequestRef.current;
    setInspectedRevision(null);
    try {
      const revision = await getTemplateRevision(selectedTemplateId, revisionId);
      if (requestId !== inspectionRequestRef.current) return;
      setInspectedRevision({
        id: revision.id,
        content: revision.content,
        label: getRevisionLabel(revision),
      });
    } catch (error) {
      if (requestId === inspectionRequestRef.current)
        setError(getErrorMessage(error, 'Unable to inspect revision.'));
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
          <span className="prompt-templates-kicker">Administration</span>
          <h1>Prompts</h1>
          <p>Inspect shipped content, activate revisions, and manage prompt history.</p>
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
        <aside className="prompt-templates-sidebar" aria-label="Assignment template controls">
          <section className="prompt-templates-panel">
            <header>
              <span className="prompt-templates-section-label">Active template</span>
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
            ) : listError ? null : (
              <div className="prompt-templates-empty-small">
                <strong>No active assignment templates</strong>
                <span>Create one from the starter scaffold to unblock generation.</span>
              </div>
            )}
          </section>

          <section className="prompt-templates-panel">
            <header>
              <span className="prompt-templates-section-label">New template</span>
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
          {controlPlane ? (
            <TemplateControlPlane
              state={controlPlane}
              busy={isBusy}
              onActivate={(id) => void handleActivateRevision(id)}
              onImportAndActivate={() => void handleImportAndActivate()}
            />
          ) : null}
          <section className="prompt-templates-editor-surface">
            <header className="prompt-templates-editor-header">
              <div>
                <span className="prompt-templates-section-label">Editor</span>
                <h2>{selectedTemplateLabel || 'No template selected'}</h2>
                <p>{currentTemplate?.id ?? 'Create or select an assignment template.'}</p>
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

            <details className="prompt-control-editor">
              <summary>Edit template content</summary>
              <p>
                Saving an operator edit activates that content immediately. It does not change the
                shipped asset.
              </p>
              <label className="prompt-templates-editor-field">
                Template content
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
              </div>
            </details>
            <div className="prompt-templates-actions">
              <button
                type="button"
                className="prompt-templates-secondary danger"
                onClick={() => void handleArchiveTemplate()}
                disabled={!selectedTemplateId || isBusy || !controlPlane?.active}
              >
                {busy === 'archiving' ? 'Archiving...' : 'Archive Template'}
              </button>
              <button
                type="button"
                className="prompt-templates-secondary"
                onClick={() => void handleMakeDefaultTemplate()}
                disabled={
                  !selectedTemplateId ||
                  isBusy ||
                  selectedTemplateIsDefault ||
                  !controlPlane?.active
                }
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

          <section className="prompt-templates-revisions-surface" aria-label="Template revisions">
            <header>
              <span className="prompt-templates-section-label">Version history</span>
              <h2>Versions</h2>
            </header>
            {inspectedRevision ? (
              <TemplateContentComparison
                active={controlPlane?.active?.content ?? ''}
                proposed={inspectedRevision.content}
                label={inspectedRevision.label}
              />
            ) : null}
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
                        <small>
                          Created {formatDateTime(revision.createdAt)} · Activated{' '}
                          {formatDateTime(revision.activatedAt)}
                        </small>
                        <code title={revision.contentHash}>
                          {revision.contentHash.slice(0, 12)}
                        </code>
                        {revision.restoredFromRevisionId ? (
                          <small>Restored from {revision.restoredFromRevisionId}</small>
                        ) : null}
                      </div>
                      <div className="prompt-templates-revision-actions">
                        <button
                          type="button"
                          className="prompt-templates-secondary"
                          disabled={isBusy}
                          onClick={() => void handleInspectRevision(revision.id)}
                        >
                          Inspect {label}
                        </button>
                        <button
                          type="button"
                          className="prompt-templates-secondary"
                          onClick={() => void handleRestoreRevision(revision.id)}
                          disabled={isBusy || !controlPlane?.databasePresent}
                        >
                          Restore
                        </button>
                        <details className="prompt-templates-support-actions">
                          <summary>More actions</summary>
                          <button
                            type="button"
                            className="prompt-templates-secondary"
                            onClick={() => void handleActivateRevision(revision.id)}
                            disabled={isBusy}
                          >
                            Activate {label}
                          </button>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="prompt-templates-muted">No template revisions to show.</p>
            )}
            {revisions.length < revisionTotal ? (
              <button
                type="button"
                className="prompt-templates-secondary"
                disabled={isBusy}
                onClick={() => void handleOlderRevisions()}
              >
                Load older revisions
              </button>
            ) : null}
          </section>
        </main>
      </div>
    </section>
  );
};
