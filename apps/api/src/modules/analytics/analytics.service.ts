import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

type AnalyticsTrackRequest = {
  events: Array<{
    sessionId: string;
    eventType: 'PAGE_VIEW' | 'LINK_CLICK' | 'WEB_VITAL' | 'FUNNEL' | 'APP_ERROR';
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
  }>;
};

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeOptionalInteger(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeOptionalFloat(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function normalizeMetaJson(value: unknown) {
  if (value == null) return null;
  try {
    const raw = JSON.stringify(value);
    if (!raw) return null;
    return raw.length > 6000 ? raw.slice(0, 6000) : raw;
  } catch {
    return null;
  }
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ingest(payload: AnalyticsTrackRequest) {
    const accepted = payload.events
      .map((event) => ({
        sessionId: normalizeOptionalText(event.sessionId, 160) || 'unknown',
        eventType: event.eventType,
        path: normalizeOptionalText(event.path, 1024),
        href: normalizeOptionalText(event.href, 2048),
        label: normalizeOptionalText(event.label, 240),
        referrerHost: normalizeOptionalText(event.referrerHost, 240),
        referrerUrl: normalizeOptionalText(event.referrerUrl, 2048),
        source: normalizeOptionalText(event.source, 240),
        medium: normalizeOptionalText(event.medium, 240),
        campaign: normalizeOptionalText(event.campaign, 240),
        deviceType: normalizeOptionalText(event.deviceType, 80),
        browser: normalizeOptionalText(event.browser, 120),
        os: normalizeOptionalText(event.os, 120),
        locale: normalizeOptionalText(event.locale, 80),
        timezone: normalizeOptionalText(event.timezone, 120),
        viewportWidth: normalizeOptionalInteger(event.viewportWidth),
        viewportHeight: normalizeOptionalInteger(event.viewportHeight),
        screenWidth: normalizeOptionalInteger(event.screenWidth),
        screenHeight: normalizeOptionalInteger(event.screenHeight),
        metricName: normalizeOptionalText(event.metricName, 80),
        metricValue: normalizeOptionalFloat(event.metricValue),
        metricUnit: normalizeOptionalText(event.metricUnit, 40),
        navigationType: normalizeOptionalText(event.navigationType, 80),
        metaJson: normalizeMetaJson(event.meta)
      }))
      .filter((event) => Boolean(event.sessionId));

    if (accepted.length === 0) {
      return { ok: true, accepted: 0 };
    }

    await this.prisma.siteAnalyticsEvent.createMany({
      data: accepted
    });

    return {
      ok: true,
      accepted: accepted.length
    };
  }
}
