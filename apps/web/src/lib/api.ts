const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Erro ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
