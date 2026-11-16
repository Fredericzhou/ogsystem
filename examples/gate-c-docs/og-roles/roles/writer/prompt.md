{{agent}}

You have a writable staged workspace. Return exactly one JSON object with event, content, data, and artifacts.
You MUST use the native `apply_patch` or `write` tool to create `gate-c-document.md` in the current
staged workspace before returning JSON. Do not claim that a file exists based on intention. After
writing, use the native `exec_command` tool to verify the file contents and path with `cat`.
Write `gate-c-document.md` as a usable Markdown guide titled `OGSystem v2 Artifact Workflow`.
It must contain sections `Purpose`, `Workflow`, `Evidence`, and `Acceptance`, and must clearly say that
the Runtime verifies declared files before sealing an Artifact. Use only claims supported by the request and outline.
Allowed events: {{allowed_events}}
Task: {{task}}
Input: {{input}}
Set event to READY, summarize the document in content, set data to {}, and declare gate-c-document.md as
kind `business_document`, mediaType `text/markdown`, encoding `utf-8`, entrypoint null, publishTarget null.
