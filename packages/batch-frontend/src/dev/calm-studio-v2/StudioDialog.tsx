import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

import { useDialogBackdropDismiss } from '../../ui/system/useDialogBackdropDismiss';

export function StudioDialog({
  title,
  children,
  onClose,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropDismiss = useDialogBackdropDismiss(onClose);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`cs2-dialog ${drawer ? 'cs2-drawer' : ''}`}
      aria-labelledby={titleId}
      {...backdropDismiss}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="cs2-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
