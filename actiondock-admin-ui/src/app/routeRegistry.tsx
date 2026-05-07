import type { ReactNode } from "react";
import type { ColorMode } from "../shared/contexts/ColorModeContext";
import { appFeatures } from "./features";

export interface AppRouteEntry {
  path: string;
  element: ReactNode;
}

export function createAppRouteEntries(colorMode: ColorMode): AppRouteEntry[] {
  return appFeatures.flatMap((feature) =>
    feature.routes(colorMode).map((route) => ({
      path: route.path,
      element: route.element
    }))
  );
}
