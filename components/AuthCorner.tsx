"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useUser } from "@/lib/auth/useUser";

/**
 * Header auth corner: email + sign-out when signed in, "Sign in" link when
 * signed out, nothing while loading or in read-only mode (auth not configured).
 */
export default function AuthCorner() {
  const t = useTranslations("auth");
  const { user, authConfigured, loading } = useUser();

  if (loading || !authConfigured) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-md border border-green-600 px-3 py-1.5 text-sm font-semibold text-green-700 transition-colors hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950/40"
      >
        {t("signIn")}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className="hidden max-w-52 truncate text-sm text-neutral-600 sm:inline dark:text-neutral-300"
        title={user.email ?? undefined}
      >
        {user.email ?? t("signedIn")}
      </span>
      {/* Sign-out endpoint owned by the auth workstream. */}
      <form action="/api/auth/signout" method="post">
        <button
          type="submit"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {t("signOut")}
        </button>
      </form>
    </div>
  );
}
