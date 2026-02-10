import type { OvNlToolAction, OvNlToolOutput } from "@/lib/types";
import { extractOvQueryFromUserText } from "@/server/ov/nlu";
import { compileOvPlan } from "@/server/ov/planner";

export type OvRunResult =
  | { ok: true; action: OvNlToolAction; args: Record<string, unknown>; confidence: number; isFollowUp: boolean }
  | { ok: false; missing: string[]; clarification: string; confidence: number };

export async function runOvFromUserText(input: {
  text: string;
  context?: {
    previousUserText?: string;
    lastOvOutput?: OvNlToolOutput | null;
  };
}): Promise<OvRunResult> {
  const nlu = await extractOvQueryFromUserText({
    text: input.text,
    context: {
      previousUserText: input.context?.previousUserText,
      lastOvOutput: input.context?.lastOvOutput,
    },
  });
  if (!nlu.ok) {
    return {
      ok: false,
      missing: nlu.missing,
      clarification: nlu.clarification,
      confidence: nlu.confidence,
    };
  }

  const planned = compileOvPlan(nlu.query);
  if (!planned.ok) {
    return { ok: false, missing: planned.missing, clarification: planned.clarification, confidence: nlu.query.confidence };
  }

  return { ok: true, action: planned.plan.action, args: planned.plan.args, confidence: nlu.query.confidence, isFollowUp: nlu.query.isFollowUp };
}
