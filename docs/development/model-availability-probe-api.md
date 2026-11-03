# Model Availability Probe API

This document defines the Team Site API for checking one discovered model with a real, minimal
request. It is intended for frontend integration. The API probes availability; it does not start an
OGSystem Run or write run evidence.

## Endpoint

```http
POST /api/v1/platform/models/probe
Content-Type: application/json
```

Use the Team Site origin and send the backend-local `modelId` exactly as returned by the platform
model catalog. For OpenCode, this includes its provider prefix.

```json
{
  "backend": "kimi",
  "modelId": "gpt-6-luna"
}
```

The route first checks the current discovery catalog. The requested pair must exist in the catalog
with `runnable: true`; otherwise the probe is not started.

## Response

Successful model request:

```json
{
  "result": {
    "backend": "kimi",
    "modelId": "gpt-6-luna",
    "status": "runnable",
    "durationMs": 842
  }
}
```

Model request failed:

```json
{
  "result": {
    "backend": "kimi",
    "modelId": "gpt-6-luna",
    "status": "unavailable",
    "durationMs": 1204,
    "message": "Provider request failed."
  }
}
```

Missing fields, an unknown backend, or a model that is not currently discovered as runnable return
HTTP 200 with `result.status: "failed"` and a `message`. A discovery service failure is reported by
the discovery endpoint as HTTP 503.

Result fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `result.backend` | string | Backend id supplied by the caller |
| `result.modelId` | string | Backend-local model id supplied by the caller |
| `result.status` | `runnable`, `unavailable`, or `failed` | Probe outcome |
| `result.durationMs` | number | Elapsed probe time when a probe was attempted |
| `result.message` | string, optional | Diagnostic for a failed probe |

The route currently uses HTTP 200 for probe outcomes, including failures. Frontends must use
`result.status` as the outcome and must not interpret HTTP 200 alone as model availability.

```js
async function probeModel(model) {
  const response = await fetch("/api/v1/platform/models/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ backend: model.backend, modelId: model.modelId })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Model probe request failed.");
  return payload.result;
}

const result = await probeModel(selectedModel);
if (result.status === "runnable") {
  // The selected model passed a live prompt probe.
} else {
  // Show result.message when present and keep the model unavailable.
}
```

## Discovery Flow

1. Read `GET /api/v1/platform/discovery` for backend sources, discovered models, and `generatedAt`.
2. To refresh the snapshot, call `POST /api/v1/platform/discovery`; this forces discovery.
3. Call the probe endpoint only for the selected model or after an explicit user action.
4. Render `runnable`, `unavailable`, or `failed` from `result.status`; show `message` when present.

`GET /api/v1/platform/models` returns only `{ "models": [...] }` when a page only needs the model
list. `GET /api/v1/platform/providers` returns backend source metadata.

Do not probe every catalog model automatically on page load or after every refresh. A probe launches
the installed backend and sends one minimal prompt to its configured model service. The request can
consume provider quota or incur usage charges. The service currently applies a 30-second timeout,
uses a temporary work directory, and removes that directory after the probe.

## Backend Coverage

The route uses the registered backend adapter's execution probe. Current coverage includes Codex,
OpenCode, Pi, Qwen Code, Kimi Code, and Ollama. Ollama probes the local model service. The catalog
must expose the backend/model pair as runnable before the route will run a probe.

The runtime CLI also probes a minimum model during `ogs models discover` / `ogs models sync`, but
that is backend discovery behavior, not a separate single-model HTTP route.
