import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Modal({ title, onClose, children, footer, size = 'medium', dismissible = true, privateTitle = false }: {
  title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren;
  size?: 'small' | 'medium' | 'large'; dismissible?: boolean; privateTitle?: boolean;
}) {
  const modal = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.current?.querySelector<HTMLElement>('h2')?.focus();
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('.modal');
      if (dialogs[dialogs.length - 1] !== modal.current) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
      const popover = document.querySelector('.range-popover');
      const focusable = [...modal.current!.querySelectorAll<HTMLElement>(selector), ...(popover?.querySelectorAll<HTMLElement>(selector) ?? [])]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); modal.current?.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div class="modal-overlay" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    <section class={`modal modal-${size}`} ref={modal} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header class="modal-header"><h2 class={privateTitle ? 'privacy' : undefined} tabIndex={-1}>{title}</h2>{dismissible && <button class="icon-button" aria-label="Close" onClick={onClose}>✕</button>}</header>
      <div class="modal-body">{children}</div>
      {footer && <footer class="modal-footer">{footer}</footer>}
    </section>
  </div>;
}
