const TOKEN_KEY = "scriptflow-admin-api-key";
const AUTH_EVENT = "scriptflow:auth-required";

export function getApiKey(): string {
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setApiKey(value: string): void {
  const normalized = value.trim();
  if (normalized) {
    window.localStorage.setItem(TOKEN_KEY, normalized);
    return;
  }
  window.localStorage.removeItem(TOKEN_KEY);
}

export function emitAuthRequired(): void {
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function onAuthRequired(handler: () => void): () => void {
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
}
