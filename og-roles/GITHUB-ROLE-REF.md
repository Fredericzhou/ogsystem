## GitHub Role References

Use `assembly.json` to reference remote role packages once local phase is stable.

Syntax:

```json
"roleRef": "github:<org>/<repo>/roles/<roleId>@<version>"
```

Do not rely on remote fetching unless the runtime is prepared to cache and verify commits. Start with `file:` references.
