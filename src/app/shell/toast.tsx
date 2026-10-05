import React, { useEffect, useSyncExternalStore } from 'react';

/**
 * Toasts: short messages in the bottom-right corner.
 *
 * Errors always arrive here with a next step (a button or a sentence saying
 * what to do), so a failure never leaves someone staring at a red box with no
 * way forward. Success messages fade on their own; errors stay a little longer.
 */

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: ToastAction;
  /** ms; 0 keeps it until dismissed */
  duration: number;
}

type ToastInput = Omit<Toast, 'id' | 'duration' | 'tone'> & { duration?: number; tone?: ToastTone };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 4500,
  success: 3500,
  warning: 7000,
  error: 9000,
};

export const dismissToast = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

const push = (input: ToastInput): number => {
  const tone = input.tone ?? 'info';
  const toast: Toast = {
    ...input,
    tone,
    id: nextId++,
    duration: input.duration ?? DEFAULT_DURATION[tone],
  };
  // four at most; the oldest goes first
  toasts = [...toasts, toast].slice(-4);
  emit();
  return toast.id;
};

export const toast = {
  show: push,
  info: (title: string, message?: string, action?: ToastAction) =>
    push({ tone: 'info', title, message, action }),
  success: (title: string, message?: string, action?: ToastAction) =>
    push({ tone: 'success', title, message, action }),
  warning: (title: string, message?: string, action?: ToastAction) =>
    push({ tone: 'warning', title, message, action }),
  error: (title: string, message?: string, action?: ToastAction) =>
    push({ tone: 'error', title, message, action }),
};

const useToasts = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );

const ToastItem: React.FC<{ item: Toast }> = ({ item }) => {
  useEffect(() => {
    if (!item.duration) return;
    const timer = setTimeout(() => dismissToast(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration]);

  return (
    <div className={`ui-toast ui-toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      <span className="ui-toast__bar" aria-hidden />
      <div className="ui-toast__body">
        <strong className="ui-toast__title">{item.title}</strong>
        {item.message ? <p className="ui-toast__message">{item.message}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="ui-toast__action"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="ui-toast__close"
        aria-label="Dismiss message"
        title="Dismiss message"
        onClick={() => dismissToast(item.id)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};

export const Toaster: React.FC = () => {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div className="ui-toaster" aria-live="polite">
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  );
};
