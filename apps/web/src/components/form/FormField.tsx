import type { ReactNode } from 'react';

type FormFieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

export function FormField({ label, hint, error, children }: FormFieldProps) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-neutral-800">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="text-xs text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}
