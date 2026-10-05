import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons';

/**
 * A modal dialog for the new shell.
 *
 * Unlike the older Modal, a dialog can refuse to close: while a file is
 * uploading the close button is hidden and Escape or a stray click on the
 * backdrop does nothing, so work is only stopped by the explicit Cancel button.
 */
export const Dialog: React.FC<{
  open: boolean;
  title: string;
  description?: React.ReactNode;
  /** null makes the dialog non-dismissible (no ✕, no Escape, no backdrop click) */
  onClose: (() => void) | null;
  width?: number;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ open, title, description, onClose, width = 520, footer, className, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // first field or button inside, so keyboard users start in the dialog
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]):not(.ui-dialog__close)',
    );
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeRef.current) {
        event.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current?.();
      }}
    >
      <div
        ref={panelRef}
        className={['ui-dialog', className ?? ''].join(' ')}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="ui-dialog__head">
          <div className="ui-dialog__titles">
            <h2 className="ui-dialog__title">{title}</h2>
            {description ? <div className="ui-dialog__desc">{description}</div> : null}
          </div>
          {onClose ? (
            <button
              type="button"
              className="ui-icon-btn ui-dialog__close"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <IconX size={16} />
            </button>
          ) : null}
        </header>
        <div className="ui-dialog__body">{children}</div>
        {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
};

/** Asks before something that cannot be undone, in plain words. */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel, tone = 'danger', busy = false, onConfirm, onCancel }) => (
  <Dialog
    open={open}
    title={title}
    width={440}
    onClose={busy ? null : onCancel}
    footer={
      <>
        <button type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`ui-btn ui-btn--${tone}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <span className="ui-spin" aria-hidden /> : null}
          {confirmLabel}
        </button>
      </>
    }
  >
    <div className="ui-dialog__message">{message}</div>
  </Dialog>
);
