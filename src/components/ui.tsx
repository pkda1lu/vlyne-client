/** Small presentational primitives shared by every view. */

import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Committing text input
// ---------------------------------------------------------------------------

/**
 * A text input that reports its value only once the edit is finished.
 *
 * Saving a setting round-trips through the backend, writes the profile to disk
 * and can force the core to reload. Doing that per keystroke made typing a
 * routing rule reconnect the tunnel once per character, so edits are held
 * locally and committed on blur or Enter.
 *
 * While the field has focus the external value is ignored: a save echoing back
 * mid-edit would otherwise yank the caret to the end of the text.
 */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  className = 'input',
  style,
  type,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  type?: 'text' | 'number';
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      className={className}
      style={style}
      type={type}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Abandon the edit rather than committing half a value.
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`switch${checked ? ' switch--on' : ''}`}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    >
      <span className="switch__text">
        <span>{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      {/* The visible track is the control; the input stays for keyboard and
          screen-reader semantics. */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
      />
      <span className="switch__track" aria-hidden>
        <span className="switch__thumb" />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`segmented__option${
            option.value === value ? ' segmented__option--active' : ''
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="row row--between" style={{ marginBottom: 12 }}>
          {title && <h3 className="card__title" style={{ margin: 0 }}>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Escape closes from anywhere, including while focus is inside a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        // Only a click that both starts and ends on the backdrop dismisses,
        // so dragging a text selection out of the modal does not close it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal aria-label={title}>
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/**
 * Confirmation for a destructive action.
 *
 * `extra` hosts an option that changes what the action destroys — deleting a
 * subscription, for instance, can keep or discard the servers it brought in.
 */
export function Confirm({
  title,
  message,
  confirmLabel,
  cancelLabel,
  extra,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  extra?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className="btn btn--danger"
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {extra}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {hint && <div>{hint}</div>}
      {action}
    </div>
  );
}
