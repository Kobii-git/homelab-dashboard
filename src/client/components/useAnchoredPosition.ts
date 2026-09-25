import { useLayoutEffect, useState, type RefObject } from "react";

export function useAnchoredPosition(anchor: HTMLElement, panel: RefObject<HTMLElement | null>, nested = false, alignEnd = false) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    function place() {
      if (!panel.current) return;
      const rect = anchor.getBoundingClientRect();
      const { width, height } = panel.current.getBoundingClientRect();
      // CSS zoom changes measured viewport coordinates, but not fixed-position offsets.
      const scale = width / panel.current.offsetWidth || 1;
      const left = nested ? (rect.right + width + 4 <= window.innerWidth - 8 ? rect.right + 4 : rect.left - width - 4)
        : alignEnd ? rect.right - width : rect.left;
      const top = nested ? rect.top - 6 : rect.bottom + 4;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) / scale, top: Math.max(8, Math.min(top, window.innerHeight - height - 8)) / scale });
    }
    place();
    const frame = window.requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, panel, nested, alignEnd]);
  return position;
}
