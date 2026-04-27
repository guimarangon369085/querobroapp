const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isAmigasDaBroaLabEnabled() {
  return ENABLED_VALUES.has(
    String(process.env.NEXT_PUBLIC_ENABLE_AMIGAS_DA_BROA || '')
      .trim()
      .toLowerCase()
  );
}

