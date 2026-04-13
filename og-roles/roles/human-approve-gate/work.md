Decision event vocabulary:
- APPROVED
- REJECTED
- TIMEOUT

Guideline:
- If approval evidence is explicit and valid, emit APPROVED.
- If human explicitly declines, emit REJECTED.
- If no decision is available within policy window, emit TIMEOUT.
