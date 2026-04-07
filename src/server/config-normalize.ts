import type { RawRemcoChatConfig } from "./config-schema";
import type { RemcoChatConfig } from "./config-types";
import {
  normalizeLocalAccess,
  normalizeSkills,
} from "./config-normalize-access";
import {
  assertValidProviders,
  normalizeProviders,
} from "./config-normalize-providers";
import {
  normalizeIntentRouter,
  normalizeReasoning,
  normalizeWebTools,
} from "./config-normalize-routing";
import {
  normalizeAttachments,
  normalizeBashTools,
  normalizeHueGateway,
  normalizeOvNl,
} from "./config-normalize-integrations";

export function normalizeConfig(raw: RawRemcoChatConfig): RemcoChatConfig {
  const providers = normalizeProviders(raw.providers);
  const defaultProviderId = raw.app.default_provider_id;
  assertValidProviders(providers, defaultProviderId);

  return {
    version: 2,
    defaultProviderId,
    providers,
    skills: normalizeSkills(raw.app.skills),
    localAccess: normalizeLocalAccess(raw.app.local_access),
    intentRouter: normalizeIntentRouter(raw.app.router, providers),
    webTools: normalizeWebTools(raw.app.web_tools),
    reasoning: normalizeReasoning(raw.app.reasoning),
    bashTools: normalizeBashTools(raw.app.bash_tools),
    hueGateway: normalizeHueGateway(raw.app.hue_gateway),
    ovNl: normalizeOvNl(raw.app.ov_nl),
    attachments: normalizeAttachments(raw.app.attachments),
  };
}
