"use client";

/**
 * Visually hidden ARIA live regions for async updates (PLAN.md §3b).
 * Rendered permanently so screen readers register the regions before any
 * message arrives; a message is announced whenever its text changes.
 *
 * - `polite` — non-urgent updates, e.g. "12 places shown".
 * - `assertive` — urgent updates, e.g. viewport load errors.
 */
export default function LiveAnnouncer({
  polite = "",
  assertive = "",
}: {
  polite?: string;
  assertive?: string;
}) {
  return (
    <div className="sr-only">
      <p role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </p>
      <p role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </p>
    </div>
  );
}
