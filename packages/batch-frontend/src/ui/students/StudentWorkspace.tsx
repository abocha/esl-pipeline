import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';

import { useAssignmentNavigationGuard } from '../shell/assignment-navigation-guard';
import { StudentAreaDesignSystemStyles } from './StudentAreaDesignSystem';
import { StudentDialog } from './StudentDialog';
import { StudentDirectoryPage } from './StudentDirectoryPage';
import { type StudentEdits, StudentWorkspaceContext } from './StudentWorkspaceContext';

import './StudentWorkspace.css';

export function StudentWorkspace() {
  const match = useMatch('/students/:studentId/*');

  const pathname = useLocation().pathname;

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [version, setVersion] = useState(0);

  const [pending, setPending] = useState(false);

  const [saving, setSaving] = useState(false);

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);

  const editsRef = useRef<StudentEdits | null>(null);

  const decisionRef = useRef<((allowed: boolean) => void) | null>(null);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const registerEdits = useCallback((edits: StudentEdits | null) => {
    editsRef.current = edits;
  }, []);

  const confirmLeave = useCallback(async (nextPathname?: string) => {
    if (
      nextPathname === pathnameRef.current ||
      (!editsRef.current?.dirty && !editsRef.current?.busy)
    )
      return true;

    if (editsRef.current?.busy) {
      setActionNotice('Wait for the current Learning action to finish before leaving.');
      return false;
    }

    setActionNotice(null);

    if (decisionRef.current) return false;

    setSaveError(null);
    setPending(true);

    return new Promise<boolean>((resolve) => {
      decisionRef.current = resolve;
    });
  }, []);

  useAssignmentNavigationGuard(confirmLeave);

  useEffect(
    () => () => {
      decisionRef.current?.(false);
    },
    [],
  );

  const decide = (allowed: boolean) => {
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setPending(false);
    resolve?.(allowed);
  };

  const context = useMemo(
    () => ({ version, refresh, confirmLeave, registerEdits }),
    [version, refresh, confirmLeave, registerEdits],
  );

  return (
    <StudentWorkspaceContext.Provider value={context}>
      <section
        className={`student-workspace-layout student-area-theme${match ? '' : ' no-selection'}`}
      >
        <StudentAreaDesignSystemStyles />
        <StudentDirectoryPage />
        <div className="student-workspace-pane">
          <Outlet key={match?.params.studentId ?? 'directory'} />
        </div>
      </section>
      {actionNotice && (
        <div className="student-action-notice" role="status">
          {actionNotice}
          <button type="button" onClick={() => setActionNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      <StudentDialog
        open={pending}
        titleId="student-unsaved-title"
        onCancel={() => {
          if (!saving) decide(false);
        }}
      >
        <h2 id="student-unsaved-title">Keep your changes?</h2>
        <p>You have unsaved Learning edits. Save them before moving on, or discard them.</p>
        {saveError && <p role="alert">{saveError}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={saving} onClick={() => decide(false)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              editsRef.current?.discard();
              decide(true);
            }}
          >
            Discard
          </button>
          {editsRef.current?.save && (
            <button
              type="button"
              className="workspace-primary-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaveError(null);

                try {
                  if (await editsRef.current?.save?.()) decide(true);
                  else
                    setSaveError(
                      'Unable to save. Your edits are still open. Cancel to review them, or try again.',
                    );
                } catch {
                  setSaveError('Unable to save. Your edits are still open.');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Save and continue'}
            </button>
          )}
        </div>
      </StudentDialog>
    </StudentWorkspaceContext.Provider>
  );
}

export function StudentWorkspaceEmpty() {
  return (
    <div className="student-workspace-empty">
      <h2>Select a student</h2>
    </div>
  );
}
