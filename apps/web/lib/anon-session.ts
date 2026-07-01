/**
 * Browser-scoped anonymous owner id for guest sessions.
 *
 * This is intentionally shared across guest conversations so the backend can
 * list and claim all anonymous sessions owned by the same browser profile.
 */
export function getAnonSessionId(): string {
  try {
    const KEY = "omk_anon_session";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `anon-${Date.now()}`;
  }
}

export function appendAnonSessionId(endpoint: string): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}anonSessionId=${encodeURIComponent(getAnonSessionId())}`;
}
