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
- content must cite specific risks or costs of feature creep.
- data.positions.minimalist must contain an object with string fields argument and risks.
- Use the language, tone, and bilingual preference from user_preferences.
