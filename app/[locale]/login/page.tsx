import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: t("metaTitle") };
}

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("login");

  return (
    // The locale layout already renders the page <main>; this is plain content.
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {t("subtitle")}
        </p>
      </div>
      <LoginForm />
      <Link
        href="/"
        className="text-sm text-emerald-700 underline dark:text-emerald-400"
      >
        {t("backToMap")}
      </Link>
    </div>
  );
}
