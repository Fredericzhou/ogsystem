#!/usr/bin/env node
import { env, stderr, stdin, stdout } from "node:process";

async function readPrompt() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

function allowedEvents() {
  return String(env.OGSYSTEM_ALLOWED_EVENTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function chooseEvent(events) {
  const explicit = (process.argv[2] || env.OGSYSTEM_DEBUG_EVENT || "").trim();
  if (explicit && (!events.length || events.includes(explicit))) return explicit;
  return events[0] || explicit || "DONE";
}

const prompt = await readPrompt();
const events = allowedEvents();
const event = chooseEvent(events);
const roleId = env.OGSYSTEM_ROLE_ID || "unknown-role";
const profileId = env.OGSYSTEM_PROFILE_ID || "profile.console.print";
const toolRef = env.OGSYSTEM_TOOL_REF || "tool.console.print";
const content = prompt || `[console-print] ${roleId}`;
stderr.write(`[console-print] role=${roleId} event=${event}\n`);
if (prompt) stderr.write(`${prompt}\n`);
stdout.write(JSON.stringify({
  event,
  content,
  data: { roleId, profileId, toolRef, allowedEvents: events }
}));
