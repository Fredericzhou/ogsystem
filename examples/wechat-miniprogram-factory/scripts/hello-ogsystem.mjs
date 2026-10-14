#!/usr/bin/env node
import { env, stdout } from "node:process";

const allowedEvents = String(env.OGSYSTEM_ALLOWED_EVENTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const event = allowedEvents[0] || "HELLO_DONE";
stdout.write(JSON.stringify({ event, content: "Hello OGSystem world" }));
