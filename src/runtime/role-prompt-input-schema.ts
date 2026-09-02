export const RUNTIME_ROLE_PROMPT_INPUT_SCHEMA_PATH = "(builtin runtime prompt input schema)";

export const RUNTIME_ROLE_PROMPT_INPUT_SCHEMA = {
  type: "object",
  required: ["allowed_events", "user_preferences", "task", "input"],
  properties: {
    role_id: { type: "string" },
    mode: { type: "string" },
    allowed_events: { type: "string" },
    user_preferences: { type: "string" },
    task: { type: "string" },
    input: { type: "string" }
  },
  additionalProperties: false
} as const;
