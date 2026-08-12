"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { getSupabaseBrowserClient } from "@/lib/auth/client";

// Inlined at build time, so this is safe to evaluate during SSR too.
const AUTH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type Phase = "idle" | "sending" | "sent";

export function LoginForm() {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!AUTH_CONFIGURED) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t("readOnlyNotice")}
      </p>
    );
  }

  if (phase === "sent") {
    return (
      <div className="space-y-2" role="status">
        <h2 className="text-lg font-medium">{t("checkEmailTitle")}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t.rich("checkEmailBody", {
            email,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setPhase("sending");
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      // /auth/callback is intentionally outside the [locale] segment.
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (otpError) {
      setError(otpError.message);
      setPhase("idle");
    } else {
      setPhase("sent");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="email">
        {t("emailLabel")}
      </label>
      <input
        id="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-emerald-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-400"
      />
      <button
        type="submit"
        disabled={phase === "sending" || email.trim().length === 0}
        className="w-full rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {phase === "sending" ? t("sending") : t("sendLink")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t("noPasswordHint")}
      </p>
    </form>
  );
}
