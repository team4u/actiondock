import { App as AntdApp, ConfigProvider } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AuthProvider } from "../shared/auth/auth";
import { ColorModeContext, type ColorMode } from "../shared/contexts/ColorModeContext";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { createAdminTheme } from "./theme";
import { AppShell } from "./AppShell";
import { AuthBoundary } from "./authBoundary";
import { queryClient } from "../shared/api/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";

function getSystemColorMode(): ColorMode {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useSystemColorMode(): ColorMode {
  const [colorMode, setColorMode] = useState<ColorMode>(getSystemColorMode);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setColorMode(event.matches ? "dark" : "light");
    };

    setColorMode(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return colorMode;
}

export function AppRoot() {
  const colorMode = useSystemColorMode();

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  const themeConfig = useMemo(() => createAdminTheme(colorMode), [colorMode]);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={themeConfig}>
        <AntdApp>
          <ErrorBoundary>
            <ColorModeContext.Provider value={colorMode}>
              <AuthProvider>
                <AuthBoundary>
                  <AppShell colorMode={colorMode} />
                </AuthBoundary>
              </AuthProvider>
            </ColorModeContext.Provider>
          </ErrorBoundary>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
