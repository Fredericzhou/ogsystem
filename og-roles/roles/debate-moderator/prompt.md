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
- event is optional for this parallel_split role. If present, it must be one of allowed_events.
- content must contain the shared round brief that both debaters should follow.
- data.debate_round must contain the current positive integer debate round.
- Use the language, tone, and bilingual preference from user_preferences.
