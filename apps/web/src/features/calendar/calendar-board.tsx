import type { ReactNode } from 'react';

type CalendarBoardProps = {
  filters: ReactNode;
  helperText?: string | null;
  toolbar: ReactNode;
  children: ReactNode;
};

export function CalendarBoard({ filters, helperText, toolbar, children }: CalendarBoardProps) {
  return (
    <div className="app-panel grid gap-4">
      {filters}
      {helperText ? <p className="text-xs text-neutral-500">{helperText}</p> : null}
      {toolbar}
      {children}
    </div>
  );
}
