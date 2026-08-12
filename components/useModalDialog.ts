"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Elements that can receive keyboard focus inside a dialog. Kept simple on
 * purpose — everything focusable in this app is covered by these selectors.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    // Skip elements hidden via display:none (offsetParent is null for those;
    // position:fixed elements would also be null, but we don't use fixed here).
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Modal-dialog focus behavior (WCAG 2.1 — 2.4.3 Focus Order, 2.1.2 No
 * Keyboard Trap done right):
 *
 * - On mount: remembers the previously focused element, then moves focus to
 *   the first focusable element inside the dialog (falling back to the
 *   container itself — give it `tabIndex={-1}`).
 * - While open: Tab / Shift+Tab cycle within the dialog; Escape closes it.
 * - On unmount: focus returns to the previously focused element.
 *
 * Attach the returned ref to the dialog container element.
 */
export function useModalDialog<T extends HTMLElement>(
  onClose: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    (focusableIn(container)[0] ?? container).focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;

      const focusables = focusableIn(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && container.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // Capture phase on document: the trap holds even if focus has strayed
    // outside the dialog (e.g. onto the map canvas).
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, []);

  return ref;
}
