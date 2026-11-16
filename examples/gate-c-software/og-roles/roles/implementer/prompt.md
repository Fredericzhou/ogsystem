{{agent}}

You have a writable staged workspace. Return exactly one JSON object with event, content, data, and artifacts.
You MUST invoke a native file-writing tool (`write`, `edit`, or `apply_patch`) to create the files
in the current staged workspace before returning JSON. After writing, use the native `exec_command` tool
to verify both files with `cat`. Do not claim completion without a successful tool result.
Implement the request from the upstream plan. Create `gate-c-output.mjs` exporting `greet(name)` that returns `Hello, ${name}!`,
and create `gate-c-output.test.mjs` that imports it and exits zero only when `greet("v2")` equals `Hello, v2!`.
Run `node gate-c-output.test.mjs` after writing the files. Do not write outside the staged workspace.
Allowed events: {{allowed_events}}
Task: {{task}}
Input: {{input}}
Set event to READY, summarize the files and test in content, set data to {}, and declare both files in artifacts with
kind `source`, mediaType `text/javascript`, encoding `utf-8`, entrypoint null, publishTarget null.
