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
- content must integrate all branch plans, explicitly respond to review_comment when present, and include milestones, staffing, legal review gates, launch gates, and risk compensation.
