import { useEffect } from "react";

const VIEWPORT_HEIGHT_VAR = "--viewport-height";

function getVisualViewportHeight(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  return window.visualViewport
    ? window.visualViewport.height
    : window.innerHeight;
}

function updateViewportHeight() {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.style.setProperty(
    VIEWPORT_HEIGHT_VAR,
    `${getVisualViewportHeight()}px`,
  );
}

/**
 * Keeps the app container sized to the visible viewport. On mobile this
 * shrinks the layout when the virtual keyboard opens so the chat composer
 * stays above the keyboard instead of being obscured.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    updateViewportHeight();

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", updateViewportHeight);
      return () =>
        visualViewport.removeEventListener("resize", updateViewportHeight);
    }

    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, []);
}
