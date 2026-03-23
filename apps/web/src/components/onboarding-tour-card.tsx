'use client';

import Link from 'next/link';

type OnboardingTourPoint = {
  label: string;
  value: string;
};

type OnboardingTourAction = {
  label: string;
  href: string;
  variant?: 'primary' | 'ghost';
};

type OnboardingTourCardProps = {
  stepLabel: string;
  title: string;
  description: string;
  points?: OnboardingTourPoint[];
  actions?: OnboardingTourAction[];
  className?: string;
};

export function OnboardingTourCard({
  stepLabel,
  title,
  description,
  points = [],
  actions = [],
  className = ''
}: OnboardingTourCardProps) {
  return (
    <div
      className={`mt-4 rounded-[26px] border border-dashed border-[color:var(--line-strong)] bg-[linear-gradient(145deg,rgba(255,249,242,0.96),rgba(255,255,255,0.78))] p-4 shadow-[0_18px_42px_rgba(57,33,20,0.08)] ${className}`.trim()}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.26em] text-neutral-500">{stepLabel}</p>
      <h3 className="mt-3 text-lg font-semibold text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm text-neutral-600">{description}</p>

      {points.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {points.map((point) => (
            <div
              key={`${point.label}-${point.value}`}
              className="rounded-[18px] border border-white/80 bg-white/80 px-4 py-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
                {point.label}
              </p>
              <p className="mt-2 text-sm font-medium text-neutral-800">{point.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="app-form-actions mt-4">
          {actions.map((action) => (
            <Link
              key={`${action.href}-${action.label}`}
              className={`app-button ${
                action.variant === 'ghost' ? 'app-button-ghost' : 'app-button-primary'
              }`}
              href={action.href}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
