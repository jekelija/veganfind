import { setRequestLocale } from "next-intl/server";
import MapApp from "@/components/map/MapApp";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <MapApp />;
}
