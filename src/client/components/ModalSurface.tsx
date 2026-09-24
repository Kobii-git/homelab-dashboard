import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const modalStack: HTMLElement[] = [];
let rootWasInert = false;
let rootAriaHidden: string | null = null;
function updateModalStack() {
  modalStack.forEach((panel, index) => {
    const covered = index !== modalStack.length - 1;
    panel.toggleAttribute("inert", covered);
    if (covered) panel.setAttribute("aria-hidden", "true"); else panel.removeAttribute("aria-hidden");
    panel.style.zIndex = String(101 + index * 2);
    const backdrop = panel.previousElementSibling as HTMLElement | null;
    if (backdrop) backdrop.style.zIndex = String(100 + index * 2);
  });
}
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function ModalSurface({
  ariaLabel,
  backdropClassName,
  className,
  initialFocusRef,
  onClose,
  children
}: {
  ariaLabel: string;
  backdropClassName: string;
  className: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    if (modalStack.length === 0) {
      rootWasInert = appRoot?.hasAttribute("inert") ?? false;
      rootAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    }
    const panel = panelRef.current!;
    modalStack.push(panel);
    updateModalStack();
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");

    const focusTimer = window.setTimeout(() => {
      const requested = initialFocusRef?.current;
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (requested ?? first ?? panelRef.current)?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      const index = modalStack.indexOf(panel);
      if (index >= 0) modalStack.splice(index, 1);
      updateModalStack();
      if (appRoot && modalStack.length === 0) {
        if (!rootWasInert) appRoot.removeAttribute("inert");
        if (rootAriaHidden === null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", rootAriaHidden);
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [initialFocusRef]);

  return createPortal(
    <>
      <div className={backdropClassName} onMouseDown={(event) => {
        event.preventDefault();
        onClose();
      }} aria-hidden="true" />
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
