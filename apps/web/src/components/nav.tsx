'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActivePath, navSections } from '@/lib/navigation-model';

export function Nav() {
  const pathname = usePathname();
  const showSectionTitles = navSections.length > 1;

  return (
    <nav className="app-nav" aria-label="Navegacao principal">
      {navSections.map((section) => (
        <section key={section.id} className="app-nav__section" aria-label={section.label}>
          {showSectionTitles ? <p className="app-nav__section-title">{section.label}</p> : null}
          {section.items.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`app-nav__link ${active ? 'app-nav__link--active' : ''}`}
              >
                <span className="app-nav__content">
                  <span>{item.label}</span>
                </span>
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
