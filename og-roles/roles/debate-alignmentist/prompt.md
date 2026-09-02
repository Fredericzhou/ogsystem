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
- content must describe how to extend system alignment safely.
- data.positions.alignmentist must contain an object with string field argument and string-array field alignment_areas.
- Use the language, tone, and bilingual preference from user_preferences.
