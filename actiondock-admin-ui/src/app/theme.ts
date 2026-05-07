import { theme, type ThemeConfig } from "antd";
import type { ColorMode } from "../shared/contexts/ColorModeContext";

export function createAdminTheme(colorMode: ColorMode): ThemeConfig {
  const isDark = colorMode === "dark";
  const accentColor = isDark ? "#8ab4ff" : "#2357d5";
  const primaryColor = isDark ? "#2f6fd6" : "#2357d5";

  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      borderRadius: 12,
      colorPrimary: primaryColor,
      colorPrimaryHover: isDark ? "#3d7ee6" : "#3a6ee0",
      colorPrimaryActive: isDark ? "#255db5" : "#1f4dbd",
      colorLink: accentColor,
      colorLinkHover: isDark ? "#a8c6ff" : "#3a6ee0",
      colorLinkActive: isDark ? "#7fa9f0" : "#1f4dbd",
      colorBgLayout: isDark ? "#212121" : "#f3f5f8",
      colorBgContainer: isDark ? "#292929" : "#ffffff",
      colorBgElevated: isDark ? "#292929" : "#ffffff",
      colorBorder: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(5, 5, 5, 0.14)",
      colorBorderSecondary: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(5, 5, 5, 0.06)",
      colorFillSecondary: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)",
      colorFillTertiary: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)",
      colorText: isDark ? "#ececec" : "rgba(0, 0, 0, 0.88)",
      colorTextSecondary: isDark ? "#b4b4b4" : "rgba(0, 0, 0, 0.65)",
      colorTextTertiary: isDark ? "#9b9b9b" : "rgba(0, 0, 0, 0.45)",
      fontFamily: "'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
      fontSize: 13,
      controlHeight: 34,
      controlHeightSM: 28,
      controlHeightLG: 38,
      padding: 12,
      paddingSM: 8,
      paddingLG: 16,
      margin: 12,
      marginSM: 8,
      marginLG: 16
    } as Record<string, unknown>,
    components: {
      Layout: {
        bodyBg: "transparent",
        headerBg: "transparent",
        siderBg: isDark ? "#171717" : "#ffffff"
      },
      Menu: {
        itemBg: "transparent",
        darkItemBg: "#171717",
        darkSubMenuItemBg: "#171717",
        itemHoverBg: isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(35, 87, 213, 0.08)",
        itemSelectedBg: isDark ? "rgba(255, 255, 255, 0.10)" : "rgba(35, 87, 213, 0.12)",
        itemSelectedColor: accentColor,
        darkItemSelectedBg: "rgba(255, 255, 255, 0.10)",
        darkItemSelectedColor: accentColor
      },
      Button: {
        primaryShadow: "none"
      },
      Tabs: {
        inkBarColor: accentColor,
        itemActiveColor: accentColor,
        itemHoverColor: isDark ? "#a8c6ff" : "#3a6ee0",
        itemSelectedColor: accentColor
      }
    }
  };
}
