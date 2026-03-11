import type { SVGProps } from 'react';

export type AppIconName =
  | 'pedidos'
  | 'clientes'
  | 'produtos'
  | 'estoque'
  | 'refresh'
  | 'external'
  | 'spark'
  | 'tools'
  | 'back'
  | 'close'
  | 'plus'
  | 'whatsapp';

type IconProps = {
  className?: string;
};

const ICON_OUTLINE = '#6b4330';
const ICON_HIGHLIGHT = '#fff9f2';

const iconStroke = {
  stroke: ICON_OUTLINE,
  strokeWidth: 1.45,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const;

function iconProps(className?: string): SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    className
  };
}

function IconPlate({ tint }: { tint: string }) {
  return (
    <>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill={tint} stroke={ICON_OUTLINE} strokeWidth="1.3" />
      <path d="M5 7.2c1.8-1.9 4.2-2.8 6.8-2.8" stroke={ICON_HIGHLIGHT} strokeWidth="1.1" strokeLinecap="round" />
    </>
  );
}

export function BroaMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M8.6 25.4c0-9.4 7-16.3 15.8-16.3 8.9 0 15.1 6.2 15.1 15 0 9.5-7 16.2-15.9 16.2-8.5 0-15-6.1-15-14.9Z
           M14.2 34.3c3 1.9 6.2 2.9 9.8 2.9 3.9 0 7.3-1.3 10.2-3.8
           M18.2 15.3c-2 2-2.7 4.3-2.2 6.8
           M25.1 13.4c-1.7 2.4-2 4.9-1.1 7.6
           M30.6 14.8c-1.2 1.9-1.6 3.9-.9 6
           M13.6 24.1c2.8-1.6 5.6-2.2 8.5-1.7 2.9.5 5.2 1.8 7 3.9
           M18 29.8c2.7-1.2 5.4-1.4 8.2-.7 2.5.7 4.5 2 6 4
           M26.8 20.8c1.2 1.1 4.2 1.1 5.4 0
           M20.4 20.1c1.5-.5 3-.5 4.5-.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AppIcon({ name, className }: { name: AppIconName; className?: string }) {
  switch (name) {
    case 'pedidos':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#fff1de" />
          <rect x="6.7" y="5.7" width="10.6" height="12.8" rx="2.1" fill="#fffdf8" {...iconStroke} />
          <path d="M9.3 9.4h5.4M9.3 11.9h5.4M9.3 14.4h3.4" {...iconStroke} />
          <circle cx="14.6" cy="15.7" r="2.2" fill="#ffc993" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <path d="m13.7 15.8.7.8 1.4-1.6" {...iconStroke} />
        </svg>
      );
    case 'clientes':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#eaf8f1" />
          <circle cx="10" cy="9.4" r="2.2" fill="#fff7e8" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <circle cx="14.8" cy="10.1" r="1.9" fill="#ffe9dc" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <path d="M6.8 17c.8-2.3 2.1-3.5 3.9-3.5 1.8 0 3.2 1.2 4 3.5" {...iconStroke} />
          <path d="M12.3 16.8c.7-1.7 1.8-2.6 3.1-2.6 1.3 0 2.4.9 3.1 2.6" {...iconStroke} />
          <circle cx="8.2" cy="11.1" r=".7" fill="#f6aba3" />
          <circle cx="16.9" cy="11.7" r=".7" fill="#f6aba3" />
        </svg>
      );
    case 'produtos':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#fff7d9" />
          <rect x="6.5" y="8" width="11" height="9.8" rx="2.2" fill="#fff8eb" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <path d="M12 8v9.8M6.5 11.1h11" {...iconStroke} />
          <circle cx="9.2" cy="13.8" r="1.1" fill="#ffa995" />
          <circle cx="14.8" cy="13.8" r="1.1" fill="#9ed5ff" />
        </svg>
      );
    case 'estoque':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#ecf3ff" />
          <rect x="6.2" y="7.2" width="11.6" height="10.6" rx="2.2" fill="#fffdf9" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <path d="M6.2 11.1h11.6M10 7.2v10.6M14 7.2v10.6" {...iconStroke} />
          <path d="M8.3 9.1h7.4" stroke={ICON_HIGHLIGHT} strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#e8f6ff" />
          <path d="M17.1 10a5.3 5.3 0 0 0-8.9-2.2" {...iconStroke} />
          <path d="M8.2 6.2v2.9H11" {...iconStroke} />
          <path d="M7 14a5.3 5.3 0 0 0 8.9 2.2" {...iconStroke} />
          <path d="M15.8 17.8v-2.9H13" {...iconStroke} />
          <circle cx="12" cy="12" r="1.1" fill="#9ed5ff" stroke={ICON_OUTLINE} strokeWidth="1.1" />
        </svg>
      );
    case 'external':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#f2eeff" />
          <rect x="6.6" y="6.6" width="9.2" height="10.8" rx="2.2" fill="#fffdfc" stroke={ICON_OUTLINE} strokeWidth="1.2" />
          <path d="M12.6 8.5h4.1v4.1" {...iconStroke} />
          <path d="m16.7 8.5-5.3 5.3" {...iconStroke} />
          <circle cx="9.4" cy="12" r=".8" fill="#f6aba3" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#ffedf5" />
          <path
            d="M12 5.8 13.7 10l4.2 1.6-4.2 1.6-1.7 4.2-1.7-4.2-4.2-1.6 4.2-1.6L12 5.8Z"
            fill="#ffe17c"
            stroke={ICON_OUTLINE}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="17.9" cy="7.5" r="1" fill="#fff" stroke={ICON_OUTLINE} strokeWidth="1" />
          <circle cx="6.9" cy="16.9" r=".9" fill="#fff" stroke={ICON_OUTLINE} strokeWidth="1" />
        </svg>
      );
    case 'tools':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <IconPlate tint="#fff0e6" />
          <path d="m8 16 4.4-4.4" {...iconStroke} />
          <path d="m9.7 7.9 6.4 6.4" {...iconStroke} />
          <ellipse cx="15.8" cy="8.2" rx="1.8" ry="1.3" fill="#ffd2a6" stroke={ICON_OUTLINE} strokeWidth="1.1" transform="rotate(45 15.8 8.2)" />
          <rect x="6.6" y="14.3" width="2.8" height="1.8" rx=".8" fill="#9ed5ff" stroke={ICON_OUTLINE} strokeWidth="1.1" transform="rotate(-45 6.6 14.3)" />
        </svg>
      );
    case 'back':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="#fff2e4" stroke={ICON_OUTLINE} strokeWidth="1.3" />
          <path d="m12.7 8.1-3.9 3.9 3.9 3.9" {...iconStroke} />
          <path d="M9.1 12h6.1" {...iconStroke} />
        </svg>
      );
    case 'close':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="#ffe8e5" stroke={ICON_OUTLINE} strokeWidth="1.3" />
          <path d="m9 9 6 6M15 9l-6 6" {...iconStroke} />
        </svg>
      );
    case 'plus':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="#e8f7e8" stroke={ICON_OUTLINE} strokeWidth="1.3" />
          <path d="M12 8.5v7M8.5 12h7" {...iconStroke} />
          <circle cx="16.5" cy="8.8" r="1" fill="#fff" stroke={ICON_OUTLINE} strokeWidth="1" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...iconProps(className)} aria-hidden="true">
          <path
            d="M12 4.2a7.8 7.8 0 0 0-6.8 11.6L4 20l4.4-1.2A7.8 7.8 0 1 0 12 4.2Z"
            fill="#25D366"
          />
          <path
            d="M9.8 8.8c.3-.3.8-.3 1.1 0l.6.7c.3.3.3.8 0 1.1l-.4.4c.2.6.6 1.1 1 1.5.4.4.9.8 1.5 1l.4-.4c.3-.3.8-.3 1.1 0l.7.6c.3.3.3.8 0 1.1l-.3.3c-.5.5-1.3.7-2 .4-1.1-.5-2.1-1.2-2.9-2.1-.9-.9-1.6-1.8-2.1-2.9-.3-.7-.1-1.5.4-2l.3-.3Z"
            fill="#fff"
          />
        </svg>
      );
    default:
      return null;
  }
}
