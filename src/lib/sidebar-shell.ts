export const DESKTOP_SIDEBAR_STORAGE_KEY = "remcochat:desktopSidebar:v1";
export const DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX = 288;
export const DESKTOP_SIDEBAR_MIN_WIDTH_PX = 240;
export const DESKTOP_SIDEBAR_MAX_WIDTH_PX = 560;

export type DesktopSidebarPrefs = {
  collapsed: boolean;
  width: number;
};

export function clampDesktopSidebarWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX;
  const rounded = Math.round(widthPx);
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH_PX,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH_PX, rounded)
  );
}

export function parseDesktopSidebarPrefs(
  raw: string | null
): DesktopSidebarPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as { collapsed?: unknown; width?: unknown };
    if (typeof candidate.collapsed !== "boolean") return null;
    if (typeof candidate.width !== "number") return null;
    return {
      collapsed: candidate.collapsed,
      width: clampDesktopSidebarWidth(candidate.width),
    };
  } catch {
    return null;
  }
}
