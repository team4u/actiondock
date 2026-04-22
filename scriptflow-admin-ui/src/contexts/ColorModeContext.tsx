import { createContext, useContext } from "react";

export type ColorMode = "light" | "dark";

export const ColorModeContext = createContext<ColorMode>("light");

export function useColorMode(): ColorMode {
  return useContext(ColorModeContext);
}
