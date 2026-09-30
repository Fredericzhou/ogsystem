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
- content must be a concise, shared investment proposal and review brief for both branches.
- data.debate_round must contain the current positive integer debate round.
- Extract the decision question, time horizon, constraints, evidence, assumptions, and missing information. On later rounds, revise the working thesis against both reviews.
- Keep the proposal falsifiable and distinguish supplied facts from assumptions. Never invent prices, financial statements, or citations.
- Use the language, tone, and bilingual preference from user_preferences.
