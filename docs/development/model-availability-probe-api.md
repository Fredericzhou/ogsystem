# Model Availability Probe API

This document defines the Team Site API for checking one discovered model with a real, minimal
request. It is intended for frontend integration. The API probes availability; it does not start an
OGSystem Run or write run evidence.

## Endpoint

Platform discovery is split into a backend health/catalog phase and an explicit model probe.
`GET /api/v1/platform/backends` returns the registered backends immediately. Each backend is
then discovered independently with `GET /api/v1/platform/backends/{backend}/discovery`.

The per-backend endpoint returns `202` with `discoveryPending: true` when the first discovery is
still running. A cached result may be returned with `stale: true`. It never uses an empty model
array to mean that discovery succeeded. `404` means the backend is not registered; `503` means
the discovery service itself failed. A backend CLI or protocol failure is represented in the
`source.status` field with HTTP `200`.

Backend statuses are `runnable`, `unavailable`, `not_installed`, `installed_but_broken`, and
`service_unavailable`. Model statuses are independent: `discovered`, `unverified`, `verified`, or
`unavailable`. A model probe failure does not change the backend status or remove its catalog.

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
    "status": "verified",
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
| `result.status` | `verified`, `unavailable`, or `failed` | Probe outcome |
| `result.durationMs` | number | Elapsed probe time when a probe was attempted |
| `result.message` | string, optional | Diagnostic for a failed probe |

The route currently uses HTTP 200 for probe outcomes, including failures. Frontends must use
`result.status` as the outcome and must not interpret HTTP 200 alone as model availability. The
runtime uses `backend + modelId` as the model identity; legacy `id` and `ref` fields are not read.

All probes run through the selected CLI's configured API provider. OGS never performs an
interactive CLI login and never copies provider credentials into the request body, project files,
or run artifacts. Pi, Qwen Code, and Kimi Code read their official user-level configuration files
(`~/.pi/agent/models.json`, `~/.qwen/settings.json`, and `~/.kimi-code/config.toml` respectively)
and receive only the configured environment variables required by the provider.

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
if (result.status === "verified") {
  // The selected model passed a live prompt probe.
} else {
  // Show result.message when present and keep the model unavailable.
}
```

## Discovery Flow

1. Read `GET /api/v1/platform/backends` and render every backend as `checking` immediately.
2. Discover each backend independently and merge its source and model catalog as it completes.
3. Call the probe endpoint only for the selected model or before a debug run.
4. Render `verified`, `unavailable`, or `failed` from `result.status`; show `message` when present.

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
