import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isAuthConfigured,
} from "@/lib/auth/server";

/** POST /api/auth/signout — clear the session cookies, back to the map. */
export async function POST(request: Request) {
  if (isAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
