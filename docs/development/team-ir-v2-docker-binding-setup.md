# Team IR v2 Docker Model Binding

This checked-in resolver is a local deployment path for Team IR v2 model Bindings. It supports role packages pinned for the current classic model teams and codex-gateway/gpt-6-luna through the local OpenCode serve at 127.0.0.1:4096. The A2A intake team uses a different Binding and is not supported by this resolver.

## Configure the resolver

Build the repository first so the Team IR runtime export exists:

    pnpm build

Set the Team Site process environment to the absolute resolver path and to the owner-only OpenCode serve password file:

    export OGS_TEAM_IR_V2_RESOLVER_MODULE="$PWD/apps/team-site/infrastructure/team-ir-v2-opencode-docker-resolver.mjs"
    export OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE="$HOME/.config/opencode/gpt6-luna-serve.env"

The password file must be readable by the Team Site process and have mode 0600. The resolver reads the OPENCODE_API_KEY assignment from the existing serve env file and passes only its value to the trusted relay container through Docker attach stdin. The model container does not receive the credential. It is not included in command arguments, environment variables, Team Run state, or logs. OGS_TEAM_IR_V2_DOCKER_BIN may name an absolute Docker executable; otherwise the resolver invokes docker without a shell.

Start the local OpenCode serve on 127.0.0.1:4096 with Basic Auth and start Team Site in the same environment. The resolver only accepts the checked-in model reference and endpoint. The model container calls the fixed relay endpoint; the relay calls the fixed OpenCode session creation and message endpoints and disables OpenCode tools for each prompt.

## Choosing a local execution path

Team IR v2 does not require Docker. This checked-in resolver is the Docker-backed local Binding; Docker is needed when the acceptance specifically covers this container boundary. For ordinary local model and Project Task behavior UAT, use the host-side resolver below. It calls the same OpenCode serve endpoints directly and creates a fresh session per Binding invocation. This avoids starting a Docker container for every invocation while preserving v2's fresh-session behavior.

Configure it with the same owner-only password file:

    export OGS_TEAM_IR_V2_RESOLVER_MODULE="$PWD/apps/team-site/infrastructure/team-ir-v2-opencode-direct-resolver.mjs"
    export OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE="$HOME/.config/opencode/gpt6-luna-serve.env"

A direct-host run can verify Team behavior with the real model and OpenCode service, but it does not verify container restrictions, filesystem isolation, or qualify as Docker Sandbox UAT. Keep Docker UAT as a separate final check of the container boundary.

Keep the direct-host resolver fail-closed as well: pin the allowed model and endpoint, load credentials from an owner-only file, disable tools, validate the response envelope and Team IR output Schema, and avoid logging prompts, credentials, or model output. The shared prompt builder removes legacy Role package format directives and unresolved template placeholders before adding the Team IR v2 envelope. The resolver runs in the Team Site process, so its code has that process's host permissions. Choose this path only when that trust boundary is acceptable.

## Fixed HTTP contract

The host-side serve address is `http://127.0.0.1:4096`; only the trusted relay reaches that same listener as `http://host.docker.internal:4096`. The relay sends HTTP Basic authentication with username `opencode` and the password read from `OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE`.

| Method | Path | Request |
| --- | --- | --- |
| `POST` | `/session` | `{"title":"Team IR model invocation"}`; response must include a valid session `id` |
| `POST` | `/session/{id}/message` | Model `{providerID:"codex-gateway",modelID:"gpt-6-luna"}`, every built-in tool from `team-ir-v2-opencode-tool-pins.json` set to `false`, `options:{structuredOutputMode:"outputFormat"}`, system prompt, and one text part containing the invocation prompt |

The adapters reject redirects, use a 120-second request timeout, limit request and response bodies to 2 MiB, and never put the password in the HTTP path or request body. OpenCode's `tools` field is a per-tool boolean override; an empty object does not disable tools. The checked-in tool pin list sets every built-in tool reported by OpenCode 1.18.20 to `false` for each prompt. Adapter and relay source digests are pinned in the resolver closure so changes to the request or egress policy change the compiled plan digest. The relay fixes the endpoint, model, and allowed request paths in source. The OpenCode health endpoint is only a network/auth diagnostic and is not model-execution evidence.

## Model output contract and configuration

The current OpenCode request uses its `format: {type:"json_schema",schema}` mode and fixed `options:{structuredOutputMode:"outputFormat"}`. The resolver builds a response schema from each Agent's output events, event-specific `dataSchema`, and required text Artifact slots; the model adapter passes that format to OpenCode and the relay validates then forwards it without changing the schema. The local OpenCode 1.18.20 config must use the native `@ai-sdk/openai` provider for the OpenAI-compatible gateway, with `supportsStructuredOutputs:true`; the same upstream URL and model are used. The `@ai-sdk/openai-compatible` adapter is not accepted for this release gate because it can return completed `StructuredOutput` objects missing the required `event` field under revision prompts. A health check, a completed protocol part, or some successful model scenarios does not prove schema enforcement. The adapter maps only the exact completed `StructuredOutput` part's input object to JSON, then independently validates the envelope and Team IR data/Artifact contracts. Other tool parts, incomplete structured responses, and mixed response forms fail closed. Unsupported structured output is not downgraded to prompt-only output.

In Studio, each Agent output event's `data schema` describes only that event's `data` payload. The response object contains `event`, matching `data`, and `artifactTexts`; use an empty object when no text Artifact is produced. Required Artifact slot IDs must be present with substantive text. The resolver requests this envelope as structured JSON, then independently validates the event name, event data, and Artifact slots. It does not extract JSON from surrounding prose, repair malformed text, or retry `invalid_output`. Failure diagnostics distinguish an empty response, Markdown fence, non-object text, and malformed object syntax without retaining response content. A diagnostic identifies the failure class; it does not establish why a model produced that text.

## Invocation, session, and startup cost

The current adapter creates a fresh model container, relay container, pair of Docker networks, and OpenCode session for each model Binding invocation. These resources are removed when the invocation finishes, fails, or is cancelled. A Team Run does not keep a container alive for each Role. This follows the v2 invocation contract: Role identity is stable, while cross-invocation state must be passed explicitly through Run task, Handoff data/Artifacts, review feedback, or the declared immediate Loop predecessor. The current v2 scope does not rely on provider session history as Role memory.

Starting a container adds process and Docker daemon overhead to each invocation. The pinned image is reused from the local image cache after it is available; there is no per-call image build. Actual startup cost depends on the host, Docker backend, image cache, concurrency, and workload. This setup has no benchmark establishing a fixed cost, and model/provider latency may dominate. Measure end-to-end latency and peak concurrent container count using the expected Run and Loop workload before changing the lifecycle.

Keep invocation containers short-lived when isolation and clean per-call state are the priority. Do not make a container persistent solely to retain Role conversation history. If latency measurements justify session reuse, it can be evaluated separately from container lifetime, but persistent OpenCode session state would introduce a new memory contract and must be explicitly scoped, checkpointed, recovered, bounded, and cleaned up before it can be relied on by a Team Run.

If container startup is material for the target workload and container-boundary evidence is not required, prefer a separately implemented and reviewed direct-host resolver over a long-lived container pool. This keeps the isolation claim accurate and avoids adding container lifecycle management just to reuse OpenCode sessions.

The current direct-host resolver reuses the same pinned role packages and output validation, but runs its HTTP adapter in the Team Site process. Review that process trust boundary before using it outside a trusted local environment.

## Container boundary

Each model invocation uses the image pinned in team-ir-v2-opencode-docker-pins.json. Docker receives no Project, repository, role-package, or other host volume mounts. The role prompt and invocation payload are sent over stdin. The model container runs as UID/GID 65532, with a read-only root filesystem, a 16 MiB no-exec temporary filesystem, no added capabilities, no-new-privileges, a per-invocation internal-only network, 512 MiB memory, one CPU, 64 processes, and a 64-file descriptor limit.

Only checked-in role package digests in the pin file are accepted. The resolver recalculates each digest before release closure creation and before constructing its Binding. Binding configuration is limited to model Bindings using codex-gateway/gpt-6-luna. Outputs must be JSON, use only the declared event/data/artifactTexts fields, select a declared event, and validate against that event's Team IR output schema. Artifact input/output is limited to authorized text/plain or text/markdown content up to 1 MiB per Artifact. Tool parts, unknown protocol parts, malformed JSON, undeclared events/slots, and schema violations fail closed.

## Network and deployment limits

The model container joins a unique Docker `--internal` network with no external route. A short-lived trusted relay joins that network and a separate, unique bridge network. The model container can reach only the relay alias `team-ir-egress:4318`; it has no `host-gateway` mapping and cannot directly reach the OpenCode host or public IPs. The relay has the only host-gateway mapping and forwards to the fixed `http://host.docker.internal:4096` origin. It permits `POST /session`, `POST /session/{safe-session-id}/message`, and an unauthenticated `GET /global/health` used to verify that the upstream still returns 401 without credentials. Other paths, methods, CONNECT, target fields, undeclared request fields, different model IDs, enabled/unknown tools, and oversized request/response bodies are rejected. The credential is delivered to the relay through Docker attach stdin; it is not passed to the model container. Both Docker networks and the relay container are removed after success, failure, or cancellation.

The boundary proven here is that the model container cannot open direct egress connections and its only reachable network service is the fixed, contract-checking relay. Docker does not apply an egress firewall to the relay's own bridge interface. The checked-in relay has no generic proxy, CONNECT, or request-controlled destination and can only contact the fixed local OpenCode endpoint and paths. A compromised relay process or image could still attempt other outbound connections; deployments that include that threat must enforce relay host egress with a host firewall or separately managed egress proxy. Do not expose the Docker daemon to untrusted callers, and use a production secret manager before production deployment.

The pinned Node image includes a general runtime. The model request has no OpenCode tools configured and the adapter does not spawn child processes, but Docker does not remove the image's shell binary. This is not a claim that arbitrary code execution inside the container is impossible.

## Verification boundary

`node --test apps/team-site/tests/team-ir-v2-opencode-docker-resolver.test.mjs` checks package pins, provider rejection, and launch policy without contacting OpenCode or starting a container. `OGS_TEAM_IR_V2_DOCKER_EGRESS_PROBE=1 node --test apps/team-site/tests/team-ir-v2-opencode-docker-egress.test.mjs` starts a real pinned-image relay and internal-network client; it verifies direct public TCP refusal, upstream unauthenticated 401 forwarding, path/target/CONNECT rejection, and cleanup. This network probe is not Team IR UAT. Real UAT still requires Project Task execution through the resolver, success and controlled failure/retry evidence, restart/query verification, and final human review after machine gates pass.
