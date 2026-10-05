import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLegacyLayout } from "../src/config-layout.ts";

test("legacy overlay layout migrates to top-right with info hidden", () => {
  const config: Record<string, any> = { position: "aboveEditor", showInfo: true };
  applyLegacyLayout(config, { layout: "topRightOverlay" });
  assert.equal(config.position, "topRight");
  assert.equal(config.showInfo, false);
  assert.equal("layout" in config, false);
});

test("legacy widget layout preserves the old info panel", () => {
  const config: Record<string, any> = { position: "topRight", showInfo: false };
  applyLegacyLayout(config, { layout: "widget" });
  assert.equal(config.position, "aboveEditor");
  assert.equal(config.showInfo, true);
});

test("explicit independent settings take precedence over the legacy alias", () => {
  const config: Record<string, any> = { position: "aboveEditor", showInfo: true };
  applyLegacyLayout(config, { layout: "topRightOverlay", position: "aboveEditor", showInfo: true });
  assert.equal(config.position, "aboveEditor");
  assert.equal(config.showInfo, true);
});
