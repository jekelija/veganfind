import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
};

// Wires up i18n/request.ts (the default location) as the request config.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
