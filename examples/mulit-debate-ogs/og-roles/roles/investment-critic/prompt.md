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
- content must explain the most important objections and the evidence needed to resolve them.
- data.positions.critic must contain string fields argument and risks.
- Test the proposal against supplied evidence. Identify the strongest downside case, missing diligence, concentration or liquidity risks, and observable facts that would invalidate the thesis.
- Separate evidence from conjecture. Do not fabricate data or turn uncertainty into a confident forecast.
- Use the language, tone, and bilingual preference from user_preferences.
