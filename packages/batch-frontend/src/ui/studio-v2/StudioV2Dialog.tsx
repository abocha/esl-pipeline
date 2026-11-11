import { X } from 'lucide-react';
import { type ReactNode, useId, useLayoutEffect, useRef } from 'react';

import { useDialogBackdropDismiss } from '../system/useDialogBackdropDismiss';
import './StudioV2Dialog.css';

export function StudioV2Dialog({
  title,
  children,
  onClose,
  drawer = false,
  closeDisabled = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
  closeDisabled?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropDismiss = useDialogBackdropDismiss(closeDisabled ? undefined : onClose);

  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`studio-v2-dialog${drawer ? ' studio-v2-dialog--drawer' : ''}${wide ? ' studio-v2-dialog--wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      {...backdropDismiss}
    >
      <header className="studio-v2-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="product-button product-button--quiet studio-v2-dialog__close"
          aria-label="Close dialog"
          disabled={closeDisabled}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
