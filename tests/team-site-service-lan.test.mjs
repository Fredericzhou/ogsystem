import assert from "node:assert/strict";
import test from "node:test";
import { createLaunchdPlist } from "../scripts/team-site-service.mjs";

test("LAN launchd configuration binds all local interfaces while preserving the project root", () => {
  const plist = createLaunchdPlist({ host: "0.0.0.0", port: "4173", projectsRoot: "/tmp/ogs-projects" });
  assert.match(plist, /<key>HOST<\/key>\s*<string>0\.0\.0\.0<\/string>/);
  assert.match(plist, /<key>PORT<\/key>\s*<string>4173<\/string>/);
  assert.match(plist, /<key>OGS_SITE_PROJECTS_DIR<\/key>\s*<string>\/tmp\/ogs-projects<\/string>/);
});
