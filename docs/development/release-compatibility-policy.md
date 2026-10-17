# Current CLI Input Boundary

Status: current release boundary for `ogs` `1.0.0`

OGSystem follows the current runtime, schema, and storage contracts as one versioned product. Historical
project files and run artifacts are outside the current input boundary. The product does not provide
automatic compatibility handling or data migration for older formats; start a new project when adopting
the current release.

The CLI fails closed for:

- future or unknown configuration/schema versions;
- malformed or incomplete input;
- a run whose plan fingerprint, semantic digest, or recovery authority does not match the current setup.

Resume is strict. A readable file is not evidence that it can be resumed safely. Preserve old files only
for read-only audit outside the current runtime path.

`ogs --version` reports the installed package. `ogs help compatibility` prints this same boundary for
operators and scripts. This document is an implementation boundary, not a migration guide.
