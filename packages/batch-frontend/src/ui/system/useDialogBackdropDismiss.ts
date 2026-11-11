import { type MouseEvent, useRef } from 'react';

function isBackdropPress(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget || event.button !== 0) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom
  );
}

export function useDialogBackdropDismiss(onDismiss: (() => void) | undefined) {
  const pressedBackdrop = useRef(false);

  return {
    onPointerDown(event: MouseEvent<HTMLDialogElement>) {
      pressedBackdrop.current = Boolean(onDismiss) && isBackdropPress(event);
    },
    onPointerCancel() {
      pressedBackdrop.current = false;
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = pressedBackdrop.current && isBackdropPress(event);
      pressedBackdrop.current = false;
      if (dismiss) onDismiss?.();
    },
  };
}
