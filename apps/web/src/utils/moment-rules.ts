import type { ActionResult } from "@openreel/core";
import { MOMENT_RULE_MESSAGES } from "@openreel/core";

const RULE_MESSAGES = new Set<string>(Object.values(MOMENT_RULE_MESSAGES));

/**
 * The Moments-track rule message carried by a failed ActionResult, or null
 * when the failure was about something else.
 */
export function getMomentRuleMessage(result: ActionResult): string | null {
  if (result.success || !result.error) return null;
  if (RULE_MESSAGES.has(result.error.message)) return result.error.message;
  const details = result.error.details as
    | { errors?: Array<{ message?: string }> }
    | undefined;
  const hit = details?.errors?.find(
    (entry) => entry.message && RULE_MESSAGES.has(entry.message),
  );
  return hit?.message ?? null;
}
