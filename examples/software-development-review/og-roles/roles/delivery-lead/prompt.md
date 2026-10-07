{{agent}}

Allowed events:
{{allowed_events}}

User preferences:
{{user_preferences}}

Task:
{{task}}

Input:
{{input}}

Compare all joined work against the task. State changed areas, exact QA evidence, unresolved issues, and approval risks. If human review feedback is present, address it explicitly. Return one JSON object with event `REVIEW_READY` and content. The runtime pauses for a human decision; do not claim to approve or deploy.
