import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import AuthCorner from "@/components/AuthCorner";
import { LAUNCH_REGION } from "@/lib/region";

function LeafIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden>
      <path d="M17 3c-6.5 0-11 2.5-12.5 7C3.4 13.2 4.5 16 4.5 16s.6-1.6 2-3.1C8 11.3 10 10 13 9c-2.5 1.5-4.5 3-5.8 4.8-.9 1.2-1.4 2.4-1.6 3.2.7.1 2.7.3 4.9-.6C15 14.8 17 10 17 3z" />
    </svg>
  );
}

/**
 * App header: brand + tagline on the left, a flexible middle slot,
 * auth corner on the right. The map filter lives in the on-map legend.
 */
export default function Header() {
  const t = useTranslations("header");
  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white/95 px-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
      <Link href="/" className="flex min-w-0 items-baseline gap-2.5">
        <span className="flex items-center gap-1.5 text-lg font-bold tracking-tight text-green-700 dark:text-green-400">
          <LeafIcon />
          {t("appName")}
        </span>
        <span className="hidden truncate text-sm text-neutral-500 sm:inline dark:text-neutral-400">
          {t("tagline", { region: LAUNCH_REGION.name })}
        </span>
      </Link>

      {/* Slot for future header controls (search, region switcher, …) */}
      <div className="flex-1" />

      <AuthCorner />
    </header>
  );
}
