'use client';

import { useEffect } from 'react';
import type { BuilderConfig } from '@querobroapp/shared';
import { fetchBuilderConfigClient } from '@/lib/builder';

function applyBuilderConfig(config: BuilderConfig) {
  const root = document.documentElement;

  root.style.setProperty('--tomato-500', config.theme.primaryColor);
  root.style.setProperty('--crust-500', config.theme.secondaryColor);
  root.style.setProperty('--bg-base', config.theme.backgroundColor);
  root.style.setProperty('--surface-strong', config.theme.surfaceColor);
  root.style.setProperty('--ink-strong', config.theme.textColor);
  root.style.setProperty('--ink-muted', config.theme.mutedTextColor);
  root.style.setProperty('--font-body', config.theme.fontBody);
  root.style.setProperty('--font-display', config.theme.fontDisplay);

  root.style.setProperty('--builder-input-radius', `${config.forms.inputRadius}px`);
  root.style.setProperty('--builder-input-padding-y', `${config.forms.inputPaddingY}px`);
  root.style.setProperty('--builder-input-padding-x', `${config.forms.inputPaddingX}px`);
  root.style.setProperty('--builder-input-border-width', `${config.forms.inputBorderWidth}px`);
  root.style.setProperty('--builder-checkbox-accent', config.forms.checkboxAccentColor);
}

export function BuilderRuntimeTheme() {
  useEffect(() => {
    let active = true;

    fetchBuilderConfigClient()
      .then((config) => {
        if (!active) return;
        applyBuilderConfig(config);
      })
      .catch(() => undefined);

    const onConfigUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<BuilderConfig>;
      if (!customEvent.detail) return;
      applyBuilderConfig(customEvent.detail);
    };

    window.addEventListener('builder:config-updated', onConfigUpdated as EventListener);

    return () => {
      active = false;
      window.removeEventListener('builder:config-updated', onConfigUpdated as EventListener);
    };
  }, []);

  return null;
}
