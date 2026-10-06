import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageInfo = require("../../package.json") as { version: string };

export const OGS_VERSION = packageInfo.version;
