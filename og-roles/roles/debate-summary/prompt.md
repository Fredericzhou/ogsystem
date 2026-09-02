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
- content must contain the final decision, both sides' strongest points, and the recommended next step.
- data.summary must contain the same concise final summary as a string.
- Use the language, tone, and bilingual preference from user_preferences.
