import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX,
  DESKTOP_SIDEBAR_STORAGE_KEY,
  type DesktopSidebarPrefs,
  parseDesktopSidebarPrefs,
} from "@/lib/sidebar-shell";

function getDefaultDesktopSidebarPrefs(): DesktopSidebarPrefs {
  return {
    collapsed: false,
    width: DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX,
  };
}

function readStoredDesktopSidebarPrefs(): DesktopSidebarPrefs | null {
  if (typeof window === "undefined") return null;

  return parseDesktopSidebarPrefs(
    window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY),
  );
}

export function buildDesktopSidebarLayout(input: {
  collapsed: boolean;
  widthPx: number;
}): {
  desktopGridStyle: CSSProperties;
} {
  const resolvedDesktopSidebarWidthPx = clampDesktopSidebarWidth(input.widthPx);
  const desktopSidebarColumns = input.collapsed
    ? "0px minmax(0, 1fr)"
    : `${resolvedDesktopSidebarWidthPx}px minmax(0, 1fr)`;
  return {
    desktopGridStyle: {
      "--rc-desktop-sidebar-cols": desktopSidebarColumns,
    } as CSSProperties,
  };
}

function persistDesktopSidebarPrefs(collapsed: boolean, widthPx: number) {
  try {
    window.localStorage.setItem(
      DESKTOP_SIDEBAR_STORAGE_KEY,
      JSON.stringify({
        collapsed,
        width: clampDesktopSidebarWidth(widthPx),
      }),
    );
  } catch {
    // ignore write errors
  }
}

export function useDesktopSidebarShell() {
  const [desktopSidebarPrefs, setDesktopSidebarPrefs] = useState(
    getDefaultDesktopSidebarPrefs,
  );
  const [desktopSidebarResizing, setDesktopSidebarResizing] = useState(false);
  const desktopSidebarResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const desktopSidebarCollapsed = desktopSidebarPrefs.collapsed;
  const desktopSidebarWidthPx = desktopSidebarPrefs.width;

  useEffect(() => {
    const storedPrefs = readStoredDesktopSidebarPrefs();
    if (!storedPrefs) return;

    setDesktopSidebarPrefs((prev) =>
      prev.collapsed === storedPrefs.collapsed && prev.width === storedPrefs.width
        ? prev
        : storedPrefs,
    );
  }, []);

  useEffect(() => {
    persistDesktopSidebarPrefs(
      desktopSidebarCollapsed,
      desktopSidebarWidthPx,
    );
  }, [desktopSidebarCollapsed, desktopSidebarWidthPx]);

  useEffect(() => {
    if (!desktopSidebarResizing) return;
    const { cursor: prevCursor, userSelect: prevUserSelect } =
      document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [desktopSidebarResizing]);

  const setDesktopSidebarCollapsed = useCallback((collapsed: boolean) => {
    setDesktopSidebarPrefs((prev) =>
      prev.collapsed === collapsed ? prev : { ...prev, collapsed },
    );
  }, []);

  const setDesktopSidebarWidthPx = useCallback((widthPx: number) => {
    const nextWidth = clampDesktopSidebarWidth(widthPx);
    setDesktopSidebarPrefs((prev) =>
      prev.width === nextWidth ? prev : { ...prev, width: nextWidth },
    );
  }, []);

  const startDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (desktopSidebarCollapsed) return;
      if (event.button !== 0) return;
      desktopSidebarResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: desktopSidebarWidthPx,
      };
      setDesktopSidebarResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [desktopSidebarCollapsed, desktopSidebarWidthPx],
  );

  const moveDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = desktopSidebarResizeRef.current;
      if (!state) return;
      if (state.pointerId !== event.pointerId) return;
      const delta = event.clientX - state.startX;
      const nextWidth = clampDesktopSidebarWidth(state.startWidth + delta);
      setDesktopSidebarWidthPx(nextWidth);
      // Persist immediately so a fast reload doesn't miss the effect write.
      persistDesktopSidebarPrefs(false, nextWidth);
      event.preventDefault();
    },
    [setDesktopSidebarWidthPx],
  );

  const endDesktopSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = desktopSidebarResizeRef.current;
      if (!state) return;
      if (state.pointerId !== event.pointerId) return;
      desktopSidebarResizeRef.current = null;
      setDesktopSidebarResizing(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
    },
    [],
  );

  const resetDesktopSidebarWidth = useCallback(() => {
    setDesktopSidebarWidthPx(DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX);
  }, [setDesktopSidebarWidthPx]);

  const { desktopGridStyle } = useMemo(
    () =>
      buildDesktopSidebarLayout({
        collapsed: desktopSidebarCollapsed,
        widthPx: desktopSidebarWidthPx,
      }),
    [desktopSidebarCollapsed, desktopSidebarWidthPx],
  );

  return {
    desktopGridStyle,
    desktopSidebarCollapsed,
    desktopSidebarResizing,
    endDesktopSidebarResize,
    moveDesktopSidebarResize,
    resetDesktopSidebarWidth,
    setDesktopSidebarCollapsed,
    startDesktopSidebarResize,
  };
}
