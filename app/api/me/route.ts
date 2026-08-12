import { getSessionUser, isAuthConfigured } from "@/lib/auth/server";
import type { MeResponse } from "@/lib/types";

export async function GET() {
  if (!isAuthConfigured()) {
    const body: MeResponse = { user: null, authConfigured: false };
    return Response.json(body);
  }
  const user = await getSessionUser();
  const body: MeResponse = { user, authConfigured: true };
  return Response.json(body);
}
