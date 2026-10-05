import React, { useEffect } from 'react';
import { Button } from './controls';

export const Spinner: React.FC<{ size?: number; label?: string }> = ({
  size = 16,
  label,
}) => (
  <span className="cm-spinner-wrap">
    <span
      className="cm-spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label={label ?? 'Loading'}
    />
    {label ? <span className="cm-spinner-label">{label}</span> : null}
  </span>
);

export const ProgressBar: React.FC<{
  /** 0..1, or null for an indeterminate bar */
  value: number | null;
  label?: string;
}> = ({ value, label }) => (
  <div className="cm-progress">
    {label ? <div className="cm-progress__label">{label}</div> : null}
    <div
      className={`cm-progress__track ${value === null ? 'is-indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div
        className="cm-progress__fill"
        style={value === null ? undefined : { width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}> = ({ icon, title, description, action, compact = false }) => (
  <div className={`cm-empty ${compact ? 'cm-empty--compact' : ''}`}>
    {icon ? <div className="cm-empty__icon">{icon}</div> : null}
    <h3 className="cm-empty__title">{title}</h3>
    {description ? <p className="cm-empty__description">{description}</p> : null}
    {action ? <div className="cm-empty__action">{action}</div> : null}
  </div>
);

export const ErrorState: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}> = ({ title, message, onRetry, retryLabel = 'Retry', onDismiss }) => (
  <div className="cm-error" role="alert">
    <div className="cm-error__body">
      <strong className="cm-error__title">{title}</strong>
      <p className="cm-error__message">{message}</p>
    </div>
    <div className="cm-error__actions">
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
      {onDismiss ? (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  </div>
);

export const Banner: React.FC<{
  tone: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone, children, action }) => (
  <div className={`cm-banner cm-banner--${tone}`}>
    <div>{children}</div>
    {action}
  </div>
);

export const Modal: React.FC<{
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}> = ({ open, title, description, onClose, footer, width = 520, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cm-modal-backdrop" onMouseDown={onClose}>
      <div
        className="cm-modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cm-modal__header">
          <div>
            <h2 className="cm-modal__title">{title}</h2>
            {description ? <p className="cm-modal__description">{description}</p> : null}
          </div>
          <button type="button" className="cm-icon-button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="cm-modal__body">{children}</div>
        {footer ? <footer className="cm-modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
};

export const Badge: React.FC<{
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}> = ({ tone = 'neutral', children }) => (
  <span className={`cm-badge cm-badge--${tone}`}>{children}</span>
);
