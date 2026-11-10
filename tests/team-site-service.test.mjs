import assert from "node:assert/strict";
import test from "node:test";
import { createLaunchdPlist, SERVICE_LABEL } from "../scripts/team-site-service.mjs";

test("Team Site launchd plist pins the service to the repository and persistent project root", () => {
  const plist = createLaunchdPlist({
    node: "/opt/node/bin/node",
    app: "/work/ogsystem/apps/team-site",
    logs: "/tmp/ogs logs",
    projectsRoot: "/Users/fred/.ogsystem/projects"
  });
  assert.match(plist, new RegExp(`<string>${SERVICE_LABEL.replaceAll(".", "\\.")}</string>`));
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/work\/ogsystem\/apps\/team-site\/server\.mjs<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>OGS_SITE_PROJECTS_DIR<\/key>\s*<string>\/Users\/fred\/\.ogsystem\/projects<\/string>/);
  assert.match(plist, /team-site\.stdout\.log/);
  assert.match(plist, /team-site\.stderr\.log/);
});
