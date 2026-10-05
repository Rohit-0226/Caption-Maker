import React, { useEffect, useRef, useState } from 'react';

/**
 * Closes a floating panel on a click outside it or on Escape.
 *
 * Listens on mousedown rather than click so a drag that starts inside a
 * popover (selecting text in a field, say) and ends outside does not close it.
 */
export const useDismiss = (
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, ref]);
};

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: React.ReactNode;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; separator: true };

/**
 * A button that opens a short list of actions. Used for "more" menus, so the
 * toolbar and cards show one quiet icon instead of a row of rarely-used buttons.
 */
export const MenuButton: React.FC<{
  label: string;
  items: MenuEntry[];
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
  children: React.ReactNode;
}> = ({ label, items, align = 'right', className, buttonClassName, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);

  // keyboard users land on the first action, as with a native menu
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className={['ui-menu-wrap', className ?? ''].join(' ')} ref={ref}>
      <button
        type="button"
        className={buttonClassName ?? 'ui-icon-btn'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children}
      </button>
      {open ? (
        <div
          className={`ui-menu ui-menu--${align}`}
          role="menu"
          ref={listRef}
          onKeyDown={onListKey}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) =>
            'separator' in item ? (
              <div key={item.id} className="ui-menu__sep" role="separator" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`ui-menu__item ${item.danger ? 'is-danger' : ''}`}
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon ? <span className="ui-menu__icon">{item.icon}</span> : null}
                <span className="ui-menu__label">{item.label}</span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
};

/**
 * A panel that floats under its trigger. The caller owns the open state, so
 * the trigger can show it (an active icon) and actions inside can close it.
 */
export const Popover: React.FC<{
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  width?: number;
  label: string;
  children: React.ReactNode;
}> = ({ open, onClose, trigger, align = 'left', className, width = 300, label, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, ref);
  return (
    <div className="ui-menu-wrap" ref={ref}>
      {trigger}
      {open ? (
        <div
          className={['ui-popover', `ui-popover--${align}`, className ?? ''].join(' ')}
          role="dialog"
          aria-label={label}
          style={{ width }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};
