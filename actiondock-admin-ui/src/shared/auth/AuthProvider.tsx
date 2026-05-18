import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getApiKey, onTokenChanged, setApiKey } from "./tokenStore";

interface AuthContextValue {
  apiKey: string;
  setApiKey: (value: string) => void;
  clearApiKey: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function subscribe(onStoreChange: () => void): () => void {
  return onTokenChanged(onStoreChange);
}

function getSnapshot(): string {
  return getApiKey();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const apiKey = useSyncExternalStore(subscribe, getSnapshot, () => "");
  const value = useMemo<AuthContextValue>(
    () => ({
      apiKey,
      setApiKey,
      clearApiKey: () => setApiKey("")
    }),
    [apiKey]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
