import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OV_NL_SKILL_NAME,
  isExplicitWebSearchRequest,
  isOvNlRailIntent,
  shouldPreferOvNlGatewayTool,
} from "../src/server/ov-nl-intent";

test("isOvNlRailIntent detects Dutch rail travel queries", () => {
  assert.equal(
    isOvNlRailIntent(
      "Ik wil vandaag van Almere Centrum naar Groningen. Wat is de beste treinoptie?"
    ),
    true
  );
  assert.equal(isOvNlRailIntent("Wat zijn de vertrektijden op Utrecht Centraal?"), true);
  assert.equal(isOvNlRailIntent("Geef het vertrektijdenbord van Almere Centrum."), true);
  assert.equal(
    isOvNlRailIntent("Zijn er storingen of vertragingen tussen Rotterdam en Den Haag?"),
    true
  );
});

test("isOvNlRailIntent ignores unrelated prompts", () => {
  assert.equal(isOvNlRailIntent("What is the best pizza near me?"), false);
  assert.equal(isOvNlRailIntent("/hue-instant-control set woonkamer cozy"), false);
});

test("isOvNlRailIntent does not route policy/facilities questions by default", () => {
  assert.equal(isOvNlRailIntent("Mag ik een fiets meenemen in de NS trein?"), false);
  assert.equal(isOvNlRailIntent("Wat kost een NS kaartje naar Amsterdam?"), false);
  assert.equal(isOvNlRailIntent("Heeft Utrecht Centraal bagagekluizen?"), false);
});

test("isExplicitWebSearchRequest detects explicit internet/source requests", () => {
  assert.equal(
    isExplicitWebSearchRequest("Zoek op het internet naar vertragingen tussen Amsterdam en Utrecht"),
    true
  );
  assert.equal(
    isExplicitWebSearchRequest("Please use web search and include source links."),
    true
  );
  assert.equal(isExplicitWebSearchRequest("Wat zijn de vertrektijden in Amersfoort?"), false);
});

test("shouldPreferOvNlGatewayTool prefers OV tool for rail intent", () => {
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "Ik wil vandaag van Almere Centrum naar Groningen. Wat is de beste treinoptie?",
      ovNlEnabled: true,
    }),
    true
  );
});

test("shouldPreferOvNlGatewayTool does not force OV when web is explicitly requested", () => {
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "Gebruik web search voor actuele NS verstoringen met bronnen.",
      ovNlEnabled: true,
    }),
    false
  );
});

test("shouldPreferOvNlGatewayTool follows OV skill activation", () => {
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "help",
      ovNlEnabled: true,
      explicitSkillName: OV_NL_SKILL_NAME,
    }),
    false
  );
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "help",
      ovNlEnabled: true,
      activatedSkillNames: [OV_NL_SKILL_NAME],
    }),
    false
  );
});

test("shouldPreferOvNlGatewayTool still prefers OV tool for travel queries with OV skill active", () => {
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "Wat zijn de vertrektijden op Utrecht Centraal?",
      ovNlEnabled: true,
      activatedSkillNames: [OV_NL_SKILL_NAME],
    }),
    true
  );
});

test("shouldPreferOvNlGatewayTool does not force OV when web is explicit even with OV skill", () => {
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "Use web search and include sources for NS disruptions.",
      ovNlEnabled: true,
      explicitSkillName: OV_NL_SKILL_NAME,
    }),
    false
  );
  assert.equal(
    shouldPreferOvNlGatewayTool({
      text: "Gebruik internet bronnen voor live NS updates.",
      ovNlEnabled: true,
      activatedSkillNames: [OV_NL_SKILL_NAME],
    }),
    false
  );
});
