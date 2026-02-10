import type { ReactNode } from 'react';

type FormFieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <label className="grid gap-2 text-sm text-neutral-700">
      <span className="text-xs uppercase tracking-[0.2em] text-neutral-500">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}
