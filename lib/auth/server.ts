import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getDb, schema } from "../db";

/**
 * Server-side auth helpers (PLAN.md §3): Supabase is used ONLY for auth.
 * All data reads/writes go through Drizzle in route handlers.
 *
 * READ-ONLY MODE: when the Supabase env vars are absent, isAuthConfigured()
 * is false, getSessionUser() returns null, and requireUser() yields a 503 —
 * nothing here touches Supabase at import time.
 */

export interface SessionUser {
  id: string;
  email: string | null;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Cookie-based Supabase server client over next/headers cookies.
 * Only call when isAuthConfigured() — throws otherwise.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase auth is not configured (read-only mode).");
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // cookies() is read-only inside Server Components; route handlers
          // (where we actually refresh sessions) can set them fine.
        }
      },
    },
  });
}

/** The signed-in Supabase user, or null (also null in read-only mode). */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

export type RequireUserResult =
  | { user: SessionUser; response?: undefined }
  | { user?: undefined; response: Response };

/**
 * Gate for write handlers: 503 in read-only mode, 401 when signed out,
 * 403 when banned. On success, upserts the profiles row (id = auth user id)
 * so every writer has a profile before any FK references it.
 */
export async function requireUser(): Promise<RequireUserResult> {
  if (!isAuthConfigured()) {
    return {
      response: Response.json(
        { error: "Auth is not configured; the server is in read-only mode." },
        { status: 503 },
      ),
    };
  }
  const user = await getSessionUser();
  if (!user) {
    return {
      response: Response.json(
        { error: "You must be signed in to do that." },
        { status: 401 },
      ),
    };
  }
  const db = getDb();
  const [profile] = await db
    .insert(schema.profiles)
    .values({ id: user.id, email: user.email })
    .onConflictDoUpdate({
      target: schema.profiles.id,
      set: { email: user.email },
    })
    .returning({ banned: schema.profiles.banned });
  if (profile?.banned) {
    return {
      response: Response.json(
        { error: "This account has been banned." },
        { status: 403 },
      ),
    };
  }
  return { user };
}
