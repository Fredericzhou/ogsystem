# V2 TeamVersion Freeze and Namespace Engineering Evidence

Status: engineering/API evidence captured on 2026-11-19. This record does not close Release UAT
scenario 15 or replace workflow-operator and product-owner review.

## TeamVersion Freeze

The trained software TeamVersion was read before and after a direct metadata mutation attempt:

- TeamVersion: `new-team-6258e432`
- Before/after `teamVersionStatus`: `trained`
- Before/after `projectDigest`: `a5ab7d6f600373d3fab63ce4671fb3582fcac62cfacfb5ab987a51247a0b05b3`
- Mutation: `PATCH /api/v2/team-versions/new-team-6258e432`
- Response: HTTP `409`, `TEAM_VERSION_IMMUTABLE: only a design-stage TeamVersion can be changed.`

The trained version therefore remains unchanged. The supported edit path creates a new draft
version; it does not mutate the trained TeamVersion or its existing Project Run references.

## Studio/Project Namespace Isolation

The following requests were made against the running Team Site after the namespace guard was added:

| Request | Result |
| --- | --- |
| `GET /api/v2/teams/v2-formal-management-consulting-20261119-78d35786/versions/v2-formal-management-consulting-20261119-78d35786/simulations` | HTTP `404`, `STUDIO_SIMULATION_NOT_FOUND` |
| `GET /api/v2/teams/new-team-1bd7e229/versions/new-team-1bd7e229/simulations/7bcf57ef-a329-436e-a715-7c2d0c3c14e6` | HTTP `404`, `STUDIO_SIMULATION_NOT_FOUND` |
| `GET /api/v2/projects/v2-formal-management-consulting-20261119-78d35786/simulations` | HTTP `404`, no Project Simulation endpoint |

The first request uses a real Collaboration Project ID in the Studio namespace. The second uses a
real Studio Simulation ID under the wrong TeamVersion. Both are rejected without exposing records.

## Regression Test

`apps/team-site/tests/studio-simulation-namespace.test.mjs` asserts that a Collaboration Project
record cannot be loaded as a Studio Simulation owner. The full Team Site suite passed `60/60` after
the guard and mobile Debug History changes.

## Evidence Boundary

This proves trained-version immutability and API namespace rejection. It does not prove the full
scenario 15 requirement for two independent human-reviewed Run snapshots, Studio/Project history
captures, refresh comparison, or final sign-off. The UAT row remains `Not run`.
