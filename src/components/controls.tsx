import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  block?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  children,
  className,
  disabled,
  ...rest
}) => (
  <button
    type="button"
    className={[
      'cm-button',
      `cm-button--${variant}`,
      `cm-button--${size}`,
      block ? 'cm-button--block' : '',
      loading ? 'is-loading' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    disabled={disabled || loading}
    {...rest}
  >
    {loading ? <span className="cm-button__spinner" aria-hidden /> : icon}
    {children ? <span>{children}</span> : null}
  </button>
);

export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
> = ({ label, active = false, className, children, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={['cm-icon-button', active ? 'is-active' : '', className ?? '']
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

export const Field: React.FC<{
  label: string;
  hint?: string;
  value?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, hint, value, htmlFor, children }) => (
  <div className="cm-field">
    <div className="cm-field__header">
      <label className="cm-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {value !== undefined ? <span className="cm-field__value mono">{value}</span> : null}
    </div>
    {children}
    {hint ? <p className="cm-field__hint">{hint}</p> : null}
  </div>
);

// ---------------------------------------------------------------------------
// Numeric input
// ---------------------------------------------------------------------------

export interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  id?: string;
  ariaLabel?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * A numeric field that lets you type freely — including transient states like
 * an empty box or a lone minus sign — and only clamps when you commit.
 */
export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 0,
  suffix,
  id,
  ariaLabel,
  onChange,
  onCommit,
}) => {
  const format = useCallback(
    (n: number) => (precision > 0 ? n.toFixed(precision) : String(Math.round(n))),
    [precision],
  );

  const [draft, setDraft] = useState(() => format(value));
  const focused = useRef(false);

  // follow external changes (a slider moving, undo) unless the user is typing
  useEffect(() => {
    if (!focused.current) setDraft(format(value));
  }, [value, format]);

  const commit = () => {
    focused.current = false;
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(format(next));
    if (next !== value) onChange(next);
    onCommit?.(next);
  };

  return (
    <div className="cm-number">
      <input
        id={id}
        aria-label={ariaLabel}
        className="cm-number__input mono"
        inputMode="decimal"
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = Number(e.target.value);
          // live-update only when what they typed is already a usable number
          if (e.target.value.trim() !== '' && Number.isFinite(parsed)) {
            onChange(clamp(parsed, min, max));
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step);
            const next = clamp(Number(draft || 0) + delta, min, max);
            setDraft(format(next));
            onChange(next);
          }
        }}
      />
      {suffix ? <span className="cm-number__suffix">{suffix}</span> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Slider + number, kept in sync
// ---------------------------------------------------------------------------

export interface SliderFieldProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  suffix?: string;
  /** shown instead of the number box when the control is display-only */
  showInput?: boolean;
  onChange: (value: number) => void;
  /** fired when dragging stops — the moment worth pushing onto undo */
  onCommit?: (value: number) => void;
}

/**
 * The paired slider and numeric input.
 *
 * Both write to the same value, so typing 24 moves the slider to 24 and
 * dragging to 40 shows 40 in the box. Neither holds its own copy of the truth.
 */
export const SliderField: React.FC<SliderFieldProps> = ({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  suffix,
  showInput = true,
  onChange,
  onCommit,
}) => {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="cm-field">
      <div className="cm-field__header">
        <label className="cm-field__label" htmlFor={`${id}-range`}>
          {label}
        </label>
        {showInput ? (
          <NumberInput
            id={`${id}-number`}
            ariaLabel={`${label} value`}
            value={value}
            min={min}
            max={max}
            step={step}
            precision={precision}
            suffix={suffix}
            onChange={onChange}
            onCommit={onCommit}
          />
        ) : (
          <span className="cm-field__value mono">
            {precision > 0 ? value.toFixed(precision) : Math.round(value)}
            {suffix}
          </span>
        )}
      </div>
      <input
        id={`${id}-range`}
        className="cm-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--cm-slider-fill' as string]: `${percent}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        onKeyUp={() => onCommit?.(value)}
      />
      {hint ? <p className="cm-field__hint">{hint}</p> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  id,
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="cm-select">
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <svg className="cm-select__arrow" viewBox="0 0 12 12" aria-hidden>
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="cm-segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => {
  const id = useId();
  return (
    <div className="cm-toggle-row">
      <div className="cm-toggle-row__text">
        <label htmlFor={id}>{label}</label>
        {hint ? <p className="cm-field__hint">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`cm-toggle ${checked ? 'is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="cm-toggle__thumb" />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const normaliseHex = (input: string): string | null => {
  const match = HEX.exec(input.trim());
  if (!match) return null;
  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  return `#${full.toUpperCase()}`;
};

export const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  recent?: string[];
}> = ({ label, value, onChange, onReset, recent }) => {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  // a colour with alpha (rgba from a preset) cannot go in a native colour input
  const swatchValue = normaliseHex(value) ?? '#000000';

  return (
    <div className="cm-field">
      <div className="cm-field__header">
        <label className="cm-field__label" htmlFor={id}>
          {label}
        </label>
        {onReset ? (
          <button type="button" className="cm-field__reset" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </div>

      <div className="cm-color">
        <label className="cm-color__swatch" style={{ background: value }}>
          <input
            id={id}
            type="color"
            value={swatchValue}
            onChange={(e) => {
              setDraft(e.target.value.toUpperCase());
              onChange(e.target.value.toUpperCase());
            }}
            aria-label={`${label} colour picker`}
          />
        </label>
        <input
          className="cm-color__hex mono"
          value={draft}
          aria-label={`${label} hex value`}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normaliseHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => {
            focused.current = false;
            const hex = normaliseHex(draft);
            setDraft(hex ?? value);
          }}
        />
      </div>

      {recent && recent.length > 0 ? (
        <div className="cm-color__recent">
          {recent.map((colour) => (
            <button
              key={colour}
              type="button"
              className="cm-color__recent-swatch"
              style={{ background: colour }}
              title={colour}
              aria-label={`Use ${colour}`}
              onClick={() => onChange(colour)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};
