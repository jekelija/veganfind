import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import Header from "@/components/Header";
import { LAUNCH_REGION } from "@/lib/region";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title", { region: LAUNCH_REGION.name }),
    description: t("description", { region: LAUNCH_REGION.name }),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  // The [locale] segment catches unknown top-level paths too — 404 anything
  // that isn't a configured locale.
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex h-dvh min-h-full flex-col overflow-hidden bg-background text-foreground">
        {/* Inherits locale + messages from i18n/request.ts for client components. */}
        <NextIntlClientProvider>
          <Header />
          <main className="relative min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
