import { useMemo } from 'react';

import type { AdminTemplateRevisionDto, TemplateControlPlaneDto } from '@esl-pipeline/contracts';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import { formatTutorTime } from '../../utils/tutor-time';
import { diffTemplateContent } from './template-diff';

const driftLabels = {
  in_sync: 'Up to date',
  update_available: 'Update available',
  shipped_not_imported: 'Shipped content not imported',
  not_shipped: 'No shipped asset',
};

function RevisionMetadata({ revision }: { revision: AdminTemplateRevisionDto }) {
  const timezone = useWorkspaceTimezone();
  return (
    <dl className="prompt-control-metadata">
      <dt>Revision</dt>
      <dd>
        {revision.versionLabel} · {revision.status} · {revision.source}
      </dd>
      <dt>Hash</dt>
      <dd>
        <code title={revision.contentHash}>{revision.contentHash.slice(0, 12)}</code>
      </dd>
      <dt>Created</dt>
      <dd>{formatTutorTime(revision.createdAt, timezone)}</dd>
      <dt>Activated</dt>
      <dd>
        {revision.activatedAt
          ? formatTutorTime(revision.activatedAt, timezone)
          : 'Never / no longer active'}
      </dd>
      <dt>ID</dt>
      <dd>
        <code>{revision.id}</code>
      </dd>
      {revision.restoredFromRevisionId ? (
        <>
          <dt>Restored from</dt>
          <dd>{revision.restoredFromRevisionId}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function TemplateContentComparison({
  active,
  proposed,
  label,
}: {
  active: string;
  proposed: string;
  label: string;
}) {
  const lines = useMemo(() => diffTemplateContent(active, proposed), [active, proposed]);
  return (
    <details className="prompt-control-comparison" open={active !== proposed}>
      <summary>Compare active with {label}</summary>
      <p>− Removed from active · + Added in {label}</p>
      {active === proposed ? <p>Content is identical.</p> : null}
      <pre aria-label={`Active vs ${label} diff`}>
        {lines.map((line, index) => (
          <span key={`${index}-${line.kind}`} className={`prompt-diff-${line.kind}`}>
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
    </details>
  );
}

export function TemplateControlPlane({
  state,
  busy,
  onActivate,
  onImportAndActivate,
}: {
  state: TemplateControlPlaneDto;
  busy: boolean;
  onActivate: (revisionId: string) => void;
  onImportAndActivate: () => void;
}) {
  const shippedRevision = state.shipped?.matchingRevision;
  return (
    <section className="prompt-templates-revisions-surface" aria-label="Active and shipped state">
      <header>
        <span className="prompt-templates-section-label">Runtime and release</span>
        <h2>{state.label}</h2>
      </header>
      <p
        className={`prompt-templates-pill ${state.drift === 'in_sync' ? 'success' : 'warning'}`}
        role="status"
      >
        {driftLabels[state.drift]}
      </p>
      <div className="prompt-control-state">
        <article aria-label="Active revision">
          <h3>Active {state.active?.versionLabel ?? 'None'}</h3>
          {state.active ? (
            <RevisionMetadata revision={state.active} />
          ) : (
            <p>Generation has no active revision for this template.</p>
          )}
        </article>
        <article aria-label="Shipped revision">
          <h3>
            Shipped {shippedRevision?.versionLabel ?? (state.shipped ? 'Not imported' : 'None')}
          </h3>
          {shippedRevision ? (
            <RevisionMetadata revision={shippedRevision} />
          ) : state.shipped ? (
            <p>
              Hash{' '}
              <code title={state.shipped.contentHash}>
                {state.shipped.contentHash.slice(0, 12)}
              </code>
              . Import the deployed prompt assets before activation.
            </p>
          ) : (
            <p>This DB template has no asset in the running release.</p>
          )}
        </article>
      </div>
      <p>
        Shipped content comes from this running release. Generation uses the active DB revision.
        Deploying an update does not activate it.
      </p>
      {state.shipped ? (
        <TemplateContentComparison
          active={state.active?.content ?? ''}
          proposed={state.shipped.content}
          label="shipped"
        />
      ) : null}
      {shippedRevision && state.drift !== 'in_sync' ? (
        <button
          type="button"
          className="prompt-templates-primary"
          disabled={busy}
          onClick={() => onActivate(shippedRevision.id)}
        >
          Activate shipped {shippedRevision.versionLabel}
        </button>
      ) : null}
      {state.shipped && !shippedRevision ? (
        <button
          type="button"
          className="prompt-templates-primary"
          disabled={busy}
          onClick={onImportAndActivate}
        >
          Import &amp; activate
        </button>
      ) : null}
    </section>
  );
}
