import type { JSX } from 'preact';

export function DragHandle({ label, disabled = false, nativeDrag = true, onDragStart, onDragEnd, onPointerDown, onKeyDown }: {
  label: string;
  disabled?: boolean;
  nativeDrag?: boolean;
  onDragStart?: JSX.DragEventHandler<HTMLButtonElement>;
  onDragEnd?: JSX.DragEventHandler<HTMLButtonElement>;
  onPointerDown?: JSX.PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: JSX.KeyboardEventHandler<HTMLButtonElement>;
}) {
  return <button type="button" class="drag-handle" draggable={!disabled && nativeDrag} disabled={disabled} aria-label={label}
    onClick={event => event.stopPropagation()} onDragStart={onDragStart} onDragEnd={onDragEnd} onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
    <svg viewBox="0 0 12 20" aria-hidden="true" fill="currentColor">
      <circle cx="3.5" cy="4" r="1.25" /><circle cx="8.5" cy="4" r="1.25" />
      <circle cx="3.5" cy="10" r="1.25" /><circle cx="8.5" cy="10" r="1.25" />
      <circle cx="3.5" cy="16" r="1.25" /><circle cx="8.5" cy="16" r="1.25" />
    </svg>
  </button>;
}
