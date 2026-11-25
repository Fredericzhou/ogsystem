# Error Flow Compensation

V2 migration of the classic error-routing team. The role IDs, events, and edges match the
legacy Mermaid topology; only the runtime envelope is upgraded to the V2 role and binding format.

Run a graph-only check from the repository root:

```powershell
ogs run start --system examples/error-flow-compensation/system.mmd --laws examples/error-flow-compensation/.ogs/laws.json --ogs-dir examples/error-flow-compensation --input "error flow" --dry-run
```
