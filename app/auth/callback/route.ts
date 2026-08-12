import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isAuthConfigured,
} from "@/lib/auth/server";

/**
 * Magic-link landing: exchange the PKCE code for a session (the SSR client
 * writes the session cookies via next/headers), then send the user home.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!isAuthConfigured() || !code) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }
  return NextResponse.redirect(new URL("/", request.url));
}
