import { OV_NL_ROUTER_MIN_CONFIDENCE, type IntentRoute } from "@/server/intent-router";
import { OV_NL_SKILL_NAME } from "@/server/ov/ov-nl-constants";

export type OvNlRoutingPolicy = {
  skillForced: boolean;
  allowByRouter: boolean;
  forceFastPath: boolean;
  toolAllowedForPrompt: boolean | undefined;
  routerConfidence: number | null;
};

function isSkillForced(input: {
  explicitSkillName?: string | null;
}): boolean {
  const explicit = String(input.explicitSkillName ?? "").trim();
  if (explicit && explicit === OV_NL_SKILL_NAME) return true;
  return false;
}

export function computeOvNlRoutingPolicy(input: {
  routedIntent: IntentRoute | null;
  explicitSkillName?: string | null;
}): OvNlRoutingPolicy {
  const skillForced = isSkillForced({
    explicitSkillName: input.explicitSkillName,
  });

  const routerConfidence =
    input.routedIntent && typeof input.routedIntent.confidence === "number"
      ? input.routedIntent.confidence
      : null;

  const allowByRouter = Boolean(input.routedIntent && input.routedIntent.intent === "ov_nl");

  const allowFastPathByRouter = Boolean(
    input.routedIntent &&
      input.routedIntent.intent === "ov_nl" &&
      typeof input.routedIntent.confidence === "number" &&
      input.routedIntent.confidence >= OV_NL_ROUTER_MIN_CONFIDENCE
  );

  const forceFastPath = skillForced || allowFastPathByRouter;
  const toolAllowedForPrompt = skillForced ? true : input.routedIntent ? allowByRouter : undefined;

  return { skillForced, allowByRouter, forceFastPath, toolAllowedForPrompt, routerConfidence };
}
