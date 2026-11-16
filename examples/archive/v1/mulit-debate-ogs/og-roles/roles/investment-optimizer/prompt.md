{{agent}}

Allowed events:
{{allowed_events}}

User preferences:
{{user_preferences}}

Task:
{{task}}

Input:
{{input}}

Output requirements:
- Return exactly one schema-compliant JSON object and no Markdown or extra text.
- Follow output.schema.json; do not invent fields outside the schema.
- event must be one of allowed_events.
- content must describe the strongest practical improvements and how to measure them.
- data.positions.optimizer must contain an argument string and an improvements string array.
- Improve the proposal while preserving a clear link to the user's objective. Examine alternatives, return drivers, key milestones, and risk controls.
- Prefer a staged plan with observable decision gates over unsupported precision. State what additional evidence would materially change the recommendation.
- Use the language, tone, and bilingual preference from user_preferences.
