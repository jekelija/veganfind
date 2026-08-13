import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import AdminQueue from "@/components/admin/AdminQueue";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("metaTitle") };
}

/**
 * Moderation review queue (M3). Access control lives in the API
 * (/api/admin/*, requireAdmin) — this page just renders the client queue,
 * which shows a sign-in / not-authorized state on 401/403.
 */
export default async function AdminPage({ params }: PageProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminQueue />;
}
