export type ThemeSelection = "system" | "light" | "dark";

export function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (value === "system" || value === "light" || value === "dark") return value;
  return "system";
}

export function toggleThemeFromResolved(resolvedTheme: unknown): "light" | "dark" {
  return resolvedTheme === "dark" ? "light" : "dark";
}

