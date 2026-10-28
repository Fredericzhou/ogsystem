# Team IR v2 Docker Model Binding

This checked-in resolver is a local deployment path for Team IR v2 model Bindings. It supports role packages pinned for the current classic model teams and codex-gateway/gpt-6-luna through the local OpenCode serve at 127.0.0.1:4096. The A2A intake team uses a different Binding and is not supported by this resolver.

## Configure the resolver

Build the repository first so the Team IR runtime export exists:

    pnpm build

Set the Team Site process environment to the absolute resolver path and to the owner-only OpenCode serve password file:

    export OGS_TEAM_IR_V2_RESOLVER_MODULE="$PWD/apps/team-site/infrastructure/team-ir-v2-opencode-docker-resolver.mjs"
    export OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE="$HOME/.config/opencode/gpt6-luna-serve.env"

The password file must be readable by the Team Site process and have mode 0600. The resolver reads the OPENCODE_API_KEY assignment from the existing serve env file and passes only its value to the one-shot container through stdin. It is not included in command arguments, environment variables, Team Run state, or logs. OGS_TEAM_IR_V2_DOCKER_BIN may name an absolute Docker executable; otherwise the resolver invokes docker without a shell.

Start the local OpenCode serve on 127.0.0.1:4096 with Basic Auth and start Team Site in the same environment. The resolver only accepts the checked-in model reference and endpoint. The container adapter calls the fixed OpenCode session creation and message endpoints and disables OpenCode tools for each prompt.

## Fixed HTTP contract

The host-side serve address is `http://127.0.0.1:4096`; the isolated Docker container reaches that same listener as `http://host.docker.internal:4096`. The adapter sends HTTP Basic authentication with username `opencode` and the password read from `OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE`.

| Method | Path | Request |
| --- | --- | --- |
| `POST` | `/session` | `{"title":"Team IR model invocation"}`; response must include a valid session `id` |
| `POST` | `/session/{id}/message` | Model `{providerID:"codex-gateway",modelID:"gpt-6-luna"}`, `tools:{}`, system prompt, and one text part containing the invocation prompt |

The adapter rejects redirects, uses a 120-second request timeout, limits request and response bodies to 2 MiB, and never puts the password in the HTTP path or request body. The Team Site resolver fixes the endpoint, model, and allowed request paths in source and pins. The OpenCode health endpoint is only a diagnostic and is not used as model-execution evidence.

## Container boundary

Each model invocation uses the image pinned in team-ir-v2-opencode-docker-pins.json. Docker receives no Project, repository, role-package, or other host volume mounts. The role prompt and invocation payload are sent over stdin. The container runs as UID/GID 65532, with a read-only root filesystem, a 16 MiB no-exec temporary filesystem, no added capabilities, no-new-privileges, bridge networking, 512 MiB memory, one CPU, 64 processes, and a 64-file descriptor limit.

Only checked-in role package digests in the pin file are accepted. The resolver recalculates each digest before release closure creation and before constructing its Binding. Binding configuration is limited to model Bindings using codex-gateway/gpt-6-luna. Outputs must be JSON, use only the declared event/data/artifactTexts fields, select a declared event, and validate against that event's Team IR output schema. Artifact input/output is limited to authorized text/plain or text/markdown content up to 1 MiB per Artifact. Tool parts, unknown protocol parts, malformed JSON, undeclared events/slots, and schema violations fail closed.

## Network and deployment limits

Bridge networking is used so the container can call the host's loopback-only OpenCode serve through Docker's host.docker.internal mapping. Application code allowlists the exact endpoint, model, and HTTP paths, but this setup does not enforce network-level egress restrictions: the container can still attempt connections to other bridge-reachable addresses. Do not treat this as production-grade network isolation or expose the Docker daemon to untrusted callers. Use a separately enforced egress proxy/firewall and a production secret manager before production deployment.

The pinned Node image includes a general runtime. The model request has no OpenCode tools configured and the adapter does not spawn child processes, but Docker does not remove the image's shell binary. This is not a claim that arbitrary code execution inside the container is impossible.

## Verification boundary

node --test apps/team-site/tests/team-ir-v2-opencode-docker-resolver.test.mjs checks package pins, provider rejection, and Docker launch restrictions without contacting OpenCode or starting a container. A model endpoint health check or a container connectivity probe is not Team IR UAT. Real UAT still requires a published TeamVersion, Project Task execution through this resolver, success and controlled failure/retry evidence, restart/query verification, and human review. Until those flows pass with the active classic-team packages, record the UAT as not run.
