import { useEffect, useRef, useState } from 'react';

import {
  ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH,
  type AssignmentMaterial,
  assignmentSourceIdentity,
  youtubeVideoId,
} from '@esl-pipeline/contracts';

import { fetchAssignmentMaterialTranscript } from '../../utils/api';
import { assignmentMaterialErrors } from './AssignmentMaterialForm.validation';

export function AssignmentMaterialForm({
  material,
  onChange,
  sessionId,
  active = true,
  readOnly = false,
  attempted = false,
  fetchEpoch = 0,
}: {
  material: AssignmentMaterial;
  onChange: (value: AssignmentMaterial) => void;
  sessionId: string | null;
  active?: boolean;
  readOnly?: boolean;
  attempted?: boolean;
  fetchEpoch?: number;
}) {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [replacementPending, setReplacementPending] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const latest = useRef({ material, sessionId, active, readOnly, fetchEpoch });
  latest.current = { material, sessionId, active, readOnly, fetchEpoch };
  const request = useRef<symbol | null>(null);
  // A hidden step remains mounted. Invalidate pending work when leaving it, and
  // reject any result whose exact starting form has since changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset retrieval when its form identity or confirmation epoch changes.
  useEffect(() => {
    request.current = null;
    setFetching(false);
    setReplacementPending(false);
    setFetchError(null);
    setUrlTouched(false);
  }, [active, sessionId, material.mode, material.sourceUrl, fetchEpoch]);
  useEffect(
    () => () => {
      request.current = null;
    },
    [],
  );
  const errors = assignmentMaterialErrors(material);
  const stale = Boolean(
    material.sourceText.trim() &&
      assignmentSourceIdentity(material.sourceTextUrl) !==
        assignmentSourceIdentity(material.sourceUrl),
  );
  const fetchTranscript = async (replace = false) => {
    if (request.current || !sessionId || readOnly) return;
    if (material.sourceText.trim() && !replace) {
      setReplacementPending(true);
      return;
    }
    setReplacementPending(false);
    const token = Symbol('transcript');
    request.current = token;
    const snapshot = JSON.stringify(material);
    setFetching(true);
    setFetchError(null);
    try {
      const result = await fetchAssignmentMaterialTranscript(sessionId, material.sourceUrl);
      const current = latest.current;
      if (
        request.current !== token ||
        !current.active ||
        current.readOnly ||
        current.sessionId !== sessionId ||
        current.fetchEpoch !== fetchEpoch ||
        JSON.stringify(current.material) !== snapshot
      )
        return;
      onChange({ ...material, sourceText: result.sourceText, sourceTextUrl: material.sourceUrl });
    } catch (error) {
      if (
        request.current === token &&
        latest.current.sessionId === sessionId &&
        JSON.stringify(latest.current.material) === snapshot
      ) {
        setFetchError(
          error instanceof Error
            ? error.message
            : 'We couldn’t fetch a transcript. Paste it below, or get it manually.',
        );
      }
    } finally {
      if (request.current === token) {
        request.current = null;
        setFetching(false);
      }
    }
  };
  return (
    <div className="assignment-material-form">
      <fieldset className="assignment-material-choice" disabled={readOnly}>
        <legend>Assignment material</legend>
        <div className="assignment-material-options">
          {(['generated', 'authentic'] as const).map((mode) => (
            <label
              key={mode}
              className={`assignment-material-option ${material.mode === mode ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name="assignment-material"
                value={mode}
                checked={material.mode === mode}
                onChange={() => onChange({ ...material, mode })}
              />
              <span>
                <strong>{mode === 'generated' ? 'Generated' : 'Authentic'}</strong>
                <span>
                  {mode === 'generated'
                    ? 'Create a new text for this learner.'
                    : 'Use a video, article or other source.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {material.mode === 'generated' &&
      material.sourceText.length > ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH ? (
        <p className="minimal-error" role="alert">
          The saved Authentic draft exceeds 60,000 characters. Switch to Authentic and use a shorter
          excerpt.
        </p>
      ) : null}
      {material.mode === 'authentic' ? (
        <div className="assignment-authentic-fields">
          <label htmlFor="assignment-material-url">Source link</label>
          <div className="assignment-material-url-row">
            <input
              id="assignment-material-url"
              type="url"
              value={material.sourceUrl}
              readOnly={readOnly}
              aria-describedby="assignment-material-helper assignment-material-url-error"
              aria-invalid={Boolean((attempted || urlTouched) && errors.sourceUrl)}
              onBlur={() => setUrlTouched(true)}
              onChange={(event) => onChange({ ...material, sourceUrl: event.target.value })}
            />
            {youtubeVideoId(material.sourceUrl) ? (
              <button
                type="button"
                className="minimal-secondary"
                disabled={readOnly || fetching || !sessionId}
                onClick={() => void fetchTranscript()}
              >
                {fetching ? 'Fetching transcript…' : 'Fetch transcript'}
              </button>
            ) : null}
          </div>
          <p className="minimal-muted" id="assignment-material-helper">
            YouTube transcripts can be fetched. For other sources, paste an excerpt below.
          </p>
          {(attempted || urlTouched) && errors.sourceUrl ? (
            <p className="minimal-error" id="assignment-material-url-error">
              {errors.sourceUrl}
            </p>
          ) : null}
          {youtubeVideoId(material.sourceUrl) ? (
            <a href="https://youtubetotranscript.com/" target="_blank" rel="noopener noreferrer">
              Get transcript manually
            </a>
          ) : null}
          {replacementPending ? (
            <div
              role="group"
              aria-label="Replace existing source text"
              className="assignment-material-replacement"
            >
              <p>Replace the existing source text?</p>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => void fetchTranscript(true)}
              >
                Replace text
              </button>
              <button
                type="button"
                className="minimal-secondary"
                onClick={() => setReplacementPending(false)}
              >
                Keep text
              </button>
            </div>
          ) : null}
          <div aria-live="polite">
            {fetching ? <p role="status">Fetching transcript…</p> : null}
            {fetchError ? (
              <p role="status" className="minimal-error">
                {fetchError}
              </p>
            ) : null}
          </div>
          <label htmlFor="assignment-material-text">Transcript or source text</label>
          <textarea
            id="assignment-material-text"
            value={material.sourceText}
            rows={6}
            readOnly={readOnly}
            aria-invalid={Boolean(attempted && (errors.sourceText || errors.sourceTextUrl))}
            aria-describedby="assignment-material-text-error"
            onChange={(event) => {
              request.current = null;
              setFetching(false);
              onChange({
                ...material,
                sourceText: event.target.value,
                sourceTextUrl: material.sourceText.trim()
                  ? material.sourceTextUrl
                  : material.sourceUrl,
              });
            }}
          />
          {stale ? (
            <div className="assignment-material-replacement">
              <p className="minimal-error">This text belongs to the previous link.</p>
              <button
                type="button"
                className="minimal-secondary"
                disabled={readOnly}
                onClick={() => onChange({ ...material, sourceTextUrl: material.sourceUrl })}
              >
                Use this text with new link
              </button>
              <button
                type="button"
                className="minimal-secondary"
                disabled={readOnly}
                onClick={() =>
                  onChange({ ...material, sourceText: '', sourceTextUrl: material.sourceUrl })
                }
              >
                Replace text
              </button>
            </div>
          ) : null}
          {attempted && errors.sourceText ? (
            <p className="minimal-error" id="assignment-material-text-error">
              {material.sourceText.length > ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH
                ? `Use an excerpt of ${ASSIGNMENT_SOURCE_TEXT_MAX_LENGTH.toLocaleString()} characters or fewer.`
                : errors.sourceText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
