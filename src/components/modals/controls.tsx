'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Select, type SelectOption } from '@/components/ui/Select';

type BtnVariant = 'primary' | 'ghost' | 'destructive';
const BTN_BASE =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[14px] font-medium leading-5 transition active:scale-[0.98] disabled:cursor-default disabled:opacity-50';
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'border border-[var(--action)] bg-[var(--action)] text-[var(--on-action)] hover:opacity-[0.85]',
  ghost: 'border border-line-2 bg-paper-2 text-ink hover:bg-[var(--ax-tint,var(--paper-3))]',
  destructive: 'border border-[color-mix(in_srgb,var(--intent-negative)_35%,transparent)] bg-[var(--intent-negative-bg)] text-[var(--intent-negative)] hover:brightness-95',
};
export const ModalButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }
>(({ variant = 'primary', className, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(BTN_BASE, BTN_VARIANT[variant], className)} {...props} />
));
ModalButton.displayName = 'ModalButton';

const CONTROL =
  'w-full min-w-0 rounded-[10px] border border-line-2 bg-paper-2 px-3 py-2 text-[14px] leading-5 text-ink placeholder:text-ink-3 outline-none transition focus:border-clay focus:ring-[3px] focus:ring-[var(--brand-soft)]';

function Labelled({ label, required, hint, htmlFor, children }: {
  label: string; required?: boolean; hint?: string; htmlFor: string; children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium leading-5 text-ink-2">
        {label}{required && <span className="text-clay" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="text-[12px] leading-4 text-ink-3">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, id, className, ...props }:
  { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const auto = React.useId();
  const fid = id ?? auto;
  return (
    <Labelled label={label} required={props.required} hint={hint} htmlFor={fid}>
      <input id={fid} className={cn(CONTROL, className)} {...props} aria-describedby={[props['aria-describedby'], hint ? `${fid}-hint` : null].filter(Boolean).join(' ') || undefined} />
    </Labelled>
  );
}

/** Labelled dropdown — renders the unified custom <Select> (no native <select>). */
export function SelectField({ label, hint, id, required, value, onValueChange, options, placeholder, disabled }:
  { label: string; hint?: string; required?: boolean; id?: string;
    value: string; onValueChange: (value: string) => void;
    options: SelectOption[]; placeholder?: string; disabled?: boolean }) {
  const auto = React.useId();
  const fid = id ?? auto;
  return (
    <Labelled label={label} required={required} hint={hint} htmlFor={fid}>
      <Select id={fid} value={value} onValueChange={onValueChange} options={options}
        placeholder={placeholder} disabled={disabled} block ariaLabel={label} />
    </Labelled>
  );
}

export function TextAreaField({ label, hint, id, className, ...props }:
  { label: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = React.useId();
  const fid = id ?? auto;
  return (
    <Labelled label={label} required={props.required} hint={hint} htmlFor={fid}>
      <textarea id={fid} className={cn(CONTROL, 'min-h-[88px] resize-y font-mono', className)} {...props} aria-describedby={[props['aria-describedby'], hint ? `${fid}-hint` : null].filter(Boolean).join(' ') || undefined} />
    </Labelled>
  );
}
