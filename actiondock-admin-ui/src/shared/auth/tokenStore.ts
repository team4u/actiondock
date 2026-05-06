const TOKEN_KEY = "actiondock-admin-access-token";
const AUTH_EVENT = "actiondock:auth-required";
const TOKEN_CHANGE_EVENT = "actiondock:token-changed";

function dispatch(eventName: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(eventName));
}

export function getApiKey(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setApiKey(value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = value.trim();
  if (normalized) {
    window.localStorage.setItem(TOKEN_KEY, normalized);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
  dispatch(TOKEN_CHANGE_EVENT);
}

export function emitAuthRequired(): void {
  dispatch(AUTH_EVENT);
}

export function onAuthRequired(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
}

export function onTokenChanged(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(TOKEN_CHANGE_EVENT, handler);
  return () => window.removeEventListener(TOKEN_CHANGE_EVENT, handler);
}
