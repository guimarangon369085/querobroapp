const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options
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
      // keep raw text
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
