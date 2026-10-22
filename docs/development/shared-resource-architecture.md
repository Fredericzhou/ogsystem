# Shared Resource Architecture

## Ownership

OGSystem has one execution base and two product domains. The shared resource catalog is a platform capability, not a third task domain.

- Studio owns Team, TeamVersion, Team Draft design, role templates, and Simulation evidence.
- Projects owns Collaboration Project, project Materials, Task, Project Run evidence, Reviews, and Deliverables.
- Shared resources own reusable tool and storage target metadata, immutable shared dataset snapshots, and immutable role template snapshots.
- The Runtime/Harness adapter executes work for either product. It does not own Studio or Project records.

Shared resource metadata must not contain plaintext credentials. Tool and storage targets carry references and scoped capability metadata only. Run evidence remains under its owning product and is never indexed as a shared resource.

## Layers

- `domain/` owns identity and business invariants.
- `application/shared-resource-use-cases.mjs` validates commands and calls the injected resource store port.
- `infrastructure/file-shared-resource-store.mjs` owns filesystem paths, immutable publication, digests, and link rejection.
- `api/shared-resource-routes.mjs` maps HTTP requests to use cases without importing filesystem or Runtime code.
- `public/app/views/shared-resources.js` renders resource catalog pages and calls the HTTP API.
- `server.mjs` is the composition root that selects the file adapter and resource root.

These ports isolate persistence so a later SQLite/PostgreSQL adapter can replace the file adapter without moving policy into the UI or HTTP layer. This implementation does not configure OGSystem's own database; “Storage targets” are external resources that agents may reference.

## Resource Contracts

- Tool and storage target records are editable catalog metadata. They are not executable definitions and do not contain command secrets.
- Runtime CLI definitions are different from the shared tool catalog: a TeamVersion owns the `profiles.json` and `tools.json` definitions used by its roles. Studio edits these draft-owned definitions and publishes them with the TeamVersion. The shared `/platform/tools` catalog describes reusable capabilities only; connecting a catalog item to an executable adapter requires a separately authorized integration.
- Model discovery is shared, but a TeamVersion stores the selected backend/model reference as part of the immutable release input. Discovery status can change over time, so readiness and the Runtime recheck model availability when a Simulation or Project Run starts.
- Dataset publication writes a complete temporary directory next to its final version directory, records a SHA-256 digest, then publishes by rename. A published version cannot be overwritten. Reads reject symlink/junction components and verify the digest.
- Role templates are immutable, versioned snapshots of allowlisted role files. The Studio role repository copies selected assets into a Team Draft. Team design and template publication remain separate operations; editing the copy cannot change the template.
- TeamVersion publication remains immutable. Project tasks continue to bind the TeamVersion chosen at Task creation.
- Studio Simulation and Project Run evidence remain isolated by their existing owner-specific stores and APIs.

## Routes

- `/studio` and `/studio/new` manage the Team repository and Team Draft creation.
- `/studio/roles` manages reusable role templates.
- `/platform/models` exposes discovered models and shared default execution settings.
- `/platform/data`, `/platform/tools`, and `/platform/storage` manage the other shared resource catalogs.
- `/projects` remains the business workflow entry point.

## Current Limits

- Catalog and dataset persistence currently uses files. In-process writes are serialized; this server assumes one Team Site process owns the configured shared-resource root.
- Tool and storage target records are catalogs only. Runtime authorization, secret resolution, and adapter execution must remain behind separate injected ports before those records can cause external side effects.
- Dataset versions can be published and read through the platform API. Binding dataset references into Project Task and Studio Simulation inputs is not implemented; the UI states that datasets are not automatically injected into a run. Project Materials remain project-owned user input.
- Role template files are allowlisted and copied into a draft through the Studio graph's existing add-role command. Newly added roles still require topology connections and configuration before release.
