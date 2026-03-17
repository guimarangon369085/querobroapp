'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import {
  flushAnalyticsQueue,
  resolveAnalyticsAcquisition,
  resolveAnalyticsSessionId,
  trackAnalyticsEvent
} from '@/lib/analytics';

function resolveDeviceType() {
  const width = window.innerWidth || 0;
  if (width <= 767) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

function resolveBrowserAndOs() {
  const userAgent = navigator.userAgent || '';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)
    ? 'Chrome'
    : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)
    ? 'Safari'
    : /Firefox\//.test(userAgent)
    ? 'Firefox'
    : /OPR\//.test(userAgent)
    ? 'Opera'
    : 'Outro';
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
    ? 'Android'
    : /Mac OS X/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
    ? 'Windows'
    : /Linux/.test(userAgent)
    ? 'Linux'
    : 'Outro';

  return { browser, os };
}

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPathRef = useRef('/');

  useReportWebVitals((metric) => {
    if (typeof window === 'undefined') return;
    const sessionId = resolveAnalyticsSessionId();
    const acquisition = resolveAnalyticsAcquisition();
    const { browser, os } = resolveBrowserAndOs();
    trackAnalyticsEvent({
      sessionId,
      eventType: 'WEB_VITAL',
      path: currentPathRef.current,
      metricName: metric.name,
      metricValue: typeof metric.value === 'number' ? Number(metric.value) : null,
      metricUnit: metric.name === 'CLS' ? 'score' : 'ms',
      deviceType: resolveDeviceType(),
      browser,
      os,
      locale: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      source: acquisition.source,
      medium: acquisition.medium,
      campaign: acquisition.campaign,
      referrerHost: acquisition.referrerHost,
      referrerUrl: acquisition.referrerUrl,
      meta: {
        id: metric.id,
        rating: metric.rating,
        navigationType: metric.navigationType
      }
    });
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sessionId = resolveAnalyticsSessionId();
    const acquisition = resolveAnalyticsAcquisition();
    const { browser, os } = resolveBrowserAndOs();
    currentPathRef.current = pathname || '/';

    trackAnalyticsEvent({
      sessionId,
      eventType: 'PAGE_VIEW',
      path: pathname || '/',
      label: document.title || '@QUEROBROA',
      source: acquisition.source,
      medium: acquisition.medium,
      campaign: acquisition.campaign,
      referrerHost: acquisition.referrerHost,
      referrerUrl: acquisition.referrerUrl,
      deviceType: resolveDeviceType(),
      browser,
      os,
      locale: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen?.width ?? null,
      screenHeight: window.screen?.height ?? null,
      navigationType:
        performance.getEntriesByType('navigation')[0] instanceof PerformanceNavigationTiming
          ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type
          : 'spa',
      meta: {
        path: pathname || '/'
      }
    });
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;

      const sessionId = resolveAnalyticsSessionId();
      const acquisition = resolveAnalyticsAcquisition();
      const { browser, os } = resolveBrowserAndOs();
      trackAnalyticsEvent({
        sessionId,
        eventType: 'LINK_CLICK',
        path: currentPathRef.current,
        href: link.href,
        label: link.textContent?.trim() || link.getAttribute('aria-label') || 'Link',
        source: acquisition.source,
        medium: acquisition.medium,
        campaign: acquisition.campaign,
        referrerHost: acquisition.referrerHost,
        referrerUrl: acquisition.referrerUrl,
        deviceType: resolveDeviceType(),
        browser,
        os,
        locale: navigator.language || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        screenWidth: window.screen?.width ?? null,
        screenHeight: window.screen?.height ?? null
      });
    };

    const onPageHide = () => {
      void flushAnalyticsQueue({ keepalive: true });
    };

    const onError = (event: ErrorEvent) => {
      const sessionId = resolveAnalyticsSessionId();
      trackAnalyticsEvent({
        sessionId,
        eventType: 'APP_ERROR',
        path: currentPathRef.current,
        label: event.message || 'window.error',
        meta: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const sessionId = resolveAnalyticsSessionId();
      trackAnalyticsEvent({
        sessionId,
        eventType: 'APP_ERROR',
        path: currentPathRef.current,
        label: 'unhandledrejection',
        meta: {
          reason:
            typeof event.reason === 'string'
              ? event.reason
              : event.reason instanceof Error
              ? event.reason.message
              : String(event.reason)
        }
      });
    };

    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
