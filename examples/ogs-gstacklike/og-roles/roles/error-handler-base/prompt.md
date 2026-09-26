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
- content must explain the compensation, escalation, or abort decision.
- Choose COMPENSATED only after a concrete action was taken and verified; the output schema requires that evidence to be declared.
- If no safe compensation action is available, choose ESCALATED when allowed_events contains it.
- Use the language, tone, and bilingual preference from user_preferences.
