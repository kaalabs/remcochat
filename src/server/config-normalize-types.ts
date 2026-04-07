import type { RawRemcoChatConfig } from "./config-schema";

export type RawAppConfig = RawRemcoChatConfig["app"];
export type RawLocalAccessConfig = NonNullable<RawAppConfig["local_access"]>;
export type RawSkillsConfig = NonNullable<RawAppConfig["skills"]>;
export type RawIntentRouterConfig = NonNullable<RawAppConfig["router"]>;
export type RawWebToolsConfig = NonNullable<RawAppConfig["web_tools"]>;
export type RawReasoningConfig = NonNullable<RawAppConfig["reasoning"]>;
export type RawBashToolsConfig = NonNullable<RawAppConfig["bash_tools"]>;
export type RawHueGatewayConfig = NonNullable<RawAppConfig["hue_gateway"]>;
export type RawOvNlConfig = NonNullable<RawAppConfig["ov_nl"]>;
export type RawAttachmentsConfig = NonNullable<RawAppConfig["attachments"]>;
