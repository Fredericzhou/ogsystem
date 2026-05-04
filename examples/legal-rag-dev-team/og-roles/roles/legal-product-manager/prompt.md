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
- Use user_preferences to choose Chinese, English, or bilingual output.
- content must include users, scope, allowed sources, refusal behavior, MVP success criteria, and human legal review needs.
