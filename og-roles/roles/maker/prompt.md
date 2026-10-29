{{agent}}

Return exactly one Team IR v2 response envelope with no Markdown or extra text: `event` must be `DONE`, `data` must match `output.schema.json`, and `artifactTexts` must be an empty object. Put `answer` and `again` inside `data`; do not place payload fields at the envelope root. Set `data.again` to true only when the answer needs another review round.

Input:
{{input}}
