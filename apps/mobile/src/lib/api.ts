import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = '3001';

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function formatHostnameForUrl(hostname: string) {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function normalizeBaseUrl(rawUrl?: string | null) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) return '';

  try {
    return new URL(normalized).toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function parseUrlCandidate(rawValue?: string | null) {
  const candidate = String(rawValue || '').trim();
  if (!candidate) return null;

  try {
    return new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
  } catch {
    return null;
  }
}

function resolveExpoDevBaseUrl() {
  const rawCandidates = [
    Constants.expoConfig?.hostUri,
    Constants.platform?.hostUri,
    Constants.linkingUri?.startsWith('exp://') || Constants.linkingUri?.startsWith('exps://')
      ? Constants.linkingUri
      : ''
  ];

  for (const rawCandidate of rawCandidates) {
    const parsed = parseUrlCandidate(rawCandidate);
    if (!parsed?.hostname) continue;

    const resolvedHostname =
      Platform.OS === 'android' && isLoopbackHostname(parsed.hostname) ? '10.0.2.2' : parsed.hostname;
    return `http://${formatHostnameForUrl(resolvedHostname)}:${API_PORT}`;
  }

  return '';
}

export function resolveApiBaseUrl() {
  const configuredBaseUrl = normalizeBaseUrl(process.env.EXPO_PUBLIC_API_URL);
  if (configuredBaseUrl) return configuredBaseUrl;

  return resolveExpoDevBaseUrl();
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) {
    throw new Error(
      'API nao configurada. Defina EXPO_PUBLIC_API_URL com http(s)://host:3001 ou rode via Expo Go na mesma rede para inferencia automatica.'
    );
  }

  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = raw || `Erro ${res.status}`;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.message === 'string') {
        message = parsed.message;
      } else if (Array.isArray(parsed?.message)) {
        message = parsed.message.join('; ');
      } else if (typeof parsed?.error === 'string') {
        message = parsed.error;
      }
    } catch {
      // mantem mensagem textual
    }

    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
