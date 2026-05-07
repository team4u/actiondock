import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthRequired } from "../shared/auth/auth";
import { buildSystemSettingsSearch, isSystemSettingsRoute } from "../services/settingsRouting";

export function AuthBoundary({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(
    () =>
      onAuthRequired(() => {
        if (isSystemSettingsRoute(location.pathname)) {
          return;
        }

        navigate(`/settings${buildSystemSettingsSearch("console-token")}`, {
          state: {
            from: `${location.pathname}${location.search}${location.hash}`
          }
        });
      }),
    [location.hash, location.pathname, location.search, navigate]
  );

  return children;
}
