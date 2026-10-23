import { type ReactNode, useEffect, useRef } from 'react';

/** Native modal isolation/focus return, with explicit positioning over the app reset. */
export function StudentDialog({
  open,
  titleId,
  onCancel,
  children,
}: {
  open: boolean;
  titleId: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="student-workspace-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {children}
    </dialog>
  );
}
