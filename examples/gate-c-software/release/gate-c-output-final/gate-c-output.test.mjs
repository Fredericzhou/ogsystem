import assert from "node:assert/strict";
import { greet } from "./gate-c-output.mjs";

assert.equal(greet("v2"), "Hello, v2!");
