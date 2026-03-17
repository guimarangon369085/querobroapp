'use client';

type AnalyticsEventType = 'PAGE_VIEW' | 'LINK_CLICK' | 'WEB_VITAL' | 'FUNNEL' | 'APP_ERROR';

export type AnalyticsEventInput = {
  sessionId: string;
  eventType: AnalyticsEventType;
  path?: string | null;
  href?: string | null;
  label?: string | null;
  referrerHost?: string | null;
  referrerUrl?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
  locale?: string | null;
  timezone?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  metricName?: string | null;
  metricValue?: number | null;
  metricUnit?: string | null;
  navigationType?: string | null;
  meta?: unknown;
};

type AnalyticsAcquisition = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrerHost: string | null;
  referrerUrl: string | null;
};

const ANALYTICS_SESSION_STORAGE_KEY = 'querobroapp:analytics-session-id';
const ANALYTICS_ACQUISITION_STORAGE_KEY = 'querobroapp:analytics-acquisition';
const ANALYTICS_TRACK_ENDPOINT = '/api/analytics/track';
const analyticsQueue: AnalyticsEventInput[] = [];
let flushTimer: number | null = null;

function normalizeText(value: string | null | undefined, maxLength = 240) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function resolveReferrerHost(referrerUrl: string | null | undefined) {
  const value = normalizeText(referrerUrl, 2048);
  if (!value) return null;
  try {
    return normalizeText(new URL(value).hostname, 240);
  } catch {
    return null;
  }
}

export function resolveAnalyticsSessionId() {
  if (typeof window === 'undefined') return 'server';

  const existing = window.sessionStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY)?.trim();
  if (existing) return existing;

  const created = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`;
  window.sessionStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, created);
  return created;
}

export function resolveAnalyticsAcquisition() {
  if (typeof window === 'undefined') {
    return {
      source: null,
      medium: null,
      campaign: null,
      referrerHost: null,
      referrerUrl: null
    } satisfies AnalyticsAcquisition;
  }

  const params = new URLSearchParams(window.location.search);
  const currentReferrerUrl = normalizeText(document.referrer, 2048);
  const source = normalizeText(params.get('utm_source'));
  const medium = normalizeText(params.get('utm_medium'));
  const campaign = normalizeText(params.get('utm_campaign'));
  const current = {
    source,
    medium,
    campaign,
    referrerHost: resolveReferrerHost(currentReferrerUrl),
    referrerUrl: currentReferrerUrl
  } satisfies AnalyticsAcquisition;

  if (source || medium || campaign || current.referrerHost || current.referrerUrl) {
    window.sessionStorage.setItem(ANALYTICS_ACQUISITION_STORAGE_KEY, JSON.stringify(current));
    return current;
  }

  const raw = window.sessionStorage.getItem(ANALYTICS_ACQUISITION_STORAGE_KEY);
  if (!raw) return current;

  try {
    const parsed = JSON.parse(raw) as AnalyticsAcquisition;
    return {
      source: normalizeText(parsed.source),
      medium: normalizeText(parsed.medium),
      campaign: normalizeText(parsed.campaign),
      referrerHost: normalizeText(parsed.referrerHost),
      referrerUrl: normalizeText(parsed.referrerUrl, 2048)
    };
  } catch {
    return current;
  }
}

async function postAnalyticsEvents(events: AnalyticsEventInput[], keepalive = false) {
  if (events.length === 0) return;
  try {
    await fetch(ANALYTICS_TRACK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ events }),
      keepalive,
      cache: 'no-store'
    });
  } catch {
    // analytics cannot break the app
  }
}

export async function flushAnalyticsQueue(options?: { keepalive?: boolean }) {
  if (typeof window === 'undefined') return;
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (analyticsQueue.length === 0) return;
  const events = analyticsQueue.splice(0, analyticsQueue.length);
  await postAnalyticsEvents(events, options?.keepalive ?? false);
}

function scheduleAnalyticsFlush() {
  if (typeof window === 'undefined') return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushAnalyticsQueue();
  }, 1200);
}

export function trackAnalyticsEvent(event: AnalyticsEventInput) {
  if (typeof window === 'undefined') return;
  analyticsQueue.push({
    ...event,
    sessionId: normalizeText(event.sessionId, 160) || resolveAnalyticsSessionId(),
    path: normalizeText(event.path, 1024),
    href: normalizeText(event.href, 2048),
    label: normalizeText(event.label, 240),
    referrerHost: normalizeText(event.referrerHost, 240),
    referrerUrl: normalizeText(event.referrerUrl, 2048),
    source: normalizeText(event.source, 240),
    medium: normalizeText(event.medium, 240),
    campaign: normalizeText(event.campaign, 240),
    deviceType: normalizeText(event.deviceType, 80),
    browser: normalizeText(event.browser, 120),
    os: normalizeText(event.os, 120),
    locale: normalizeText(event.locale, 80),
    timezone: normalizeText(event.timezone, 120),
    metricName: normalizeText(event.metricName, 80),
    metricUnit: normalizeText(event.metricUnit, 40),
    navigationType: normalizeText(event.navigationType, 80)
  });

  if (analyticsQueue.length >= 12) {
    void flushAnalyticsQueue();
    return;
  }
  scheduleAnalyticsFlush();
}
