import type { ComponentChildren } from 'preact';

export function Modal({ title, onClose, children, footer, size = 'medium', dismissible = true }: {
  title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren;
  size?: 'small' | 'medium' | 'large'; dismissible?: boolean;
}) {
  return <div class="modal-overlay" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    <section class={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
      <header class="modal-header"><h2>{title}</h2>{dismissible && <button class="icon-button" aria-label="Close" onClick={onClose}>✕</button>}</header>
      <div class="modal-body">{children}</div>
      {footer && <footer class="modal-footer">{footer}</footer>}
    </section>
  </div>;
}
