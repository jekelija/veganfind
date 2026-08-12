/** Shared helpers for the /api route handlers (not a route itself). */

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Parse a JSON body, returning null on absent/invalid JSON. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
