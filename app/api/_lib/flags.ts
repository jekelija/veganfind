import { FLAG_REASONS } from "@/lib/db/schema";
import type { CreateFlagBody, FlagReason } from "@/lib/types";
import { jsonError } from "./util";

const MAX_FLAG_NOTE_LENGTH = 500;

/**
 * Validate a CreateFlagBody. Returns the parsed fields, or a 400 Response.
 * Shared by the place- and submission-flag routes.
 */
export function parseFlagBody(
  raw: unknown,
): { reason: FlagReason; note: string | null } | { response: Response } {
  if (raw === null || typeof raw !== "object") {
    return { response: jsonError(400, "Invalid JSON body.") };
  }
  const body = raw as Partial<CreateFlagBody>;

  if (
    typeof body.reason !== "string" ||
    !(FLAG_REASONS as readonly string[]).includes(body.reason)
  ) {
    return {
      response: jsonError(
        400,
        `reason must be one of: ${FLAG_REASONS.join(", ")}.`,
      ),
    };
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (
      typeof body.note !== "string" ||
      body.note.length > MAX_FLAG_NOTE_LENGTH
    ) {
      return {
        response: jsonError(
          400,
          `note must be a string of at most ${MAX_FLAG_NOTE_LENGTH} characters.`,
        ),
      };
    }
    note = body.note.trim() || null;
  }

  return { reason: body.reason as FlagReason, note };
}
