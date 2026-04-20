export const RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH = "(builtin runtime prompt input schema)";

export const RUNTIME_ROLE_PROMPT_INPUT_SCHEMA = {
  type: "object",
  required: [
    "task",
    "context",
    "allowed_events",
    "last_output",
    "system_notes",
    "round",
    "user_profile"
  ],
  properties: {
    task: { type: "string" },
    context: { type: "string" },
    allowed_events: { type: "string" },
    last_output: { type: "string" },
    system_notes: { type: "string" },
    round: { type: "string" },
    user_profile: { type: "string" }
  },
  additionalProperties: false
} as const;
