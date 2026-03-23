import type { ReactNode } from 'react';

type OrdersBoardProps = {
  filters: ReactNode;
  helperText?: string | null;
  summary?: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
};

export function OrdersBoard({ filters, helperText, summary, toolbar, children }: OrdersBoardProps) {
  return (
    <div className="app-panel grid gap-4">
      {filters}
      {helperText ? <p className="text-xs text-neutral-500">{helperText}</p> : null}
      {summary}
      {toolbar}
      {children}
    </div>
  );
}
