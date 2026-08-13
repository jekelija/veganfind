import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getSessionUser, isAuthConfigured } from "@/lib/auth/server";
import type { MeResponse } from "@/lib/types";

export async function GET() {
  if (!isAuthConfigured()) {
    const body: MeResponse = { user: null, authConfigured: false, isAdmin: false };
    return Response.json(body);
  }
  const user = await getSessionUser();

  let isAdmin = false;
  if (user) {
    const db = getDb();
    const [profile] = await db
      .select({ isAdmin: schema.profiles.isAdmin })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, user.id))
      .limit(1);
    isAdmin = profile?.isAdmin ?? false;
  }

  const body: MeResponse = { user, authConfigured: true, isAdmin };
  return Response.json(body);
}
