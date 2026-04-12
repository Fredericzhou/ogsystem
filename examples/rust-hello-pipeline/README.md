# Rust Hello Pipeline

Three-role full-flow validation example:

1. `rust-developer`: generate Rust `hello world` project.
2. `rust-compiler`: compile with Cargo release profile.
3. `rust-packager`: package binary and run it for output verification.

Run command:

```bash
pnpm run run:adapter -- \
  --system examples/rust-hello-pipeline/system.mmd \
  --profiles examples/rust-hello-pipeline/profiles.json \
  --tools examples/rust-hello-pipeline/tools.json \
  --laws .ogs/laws.json \
  --prompt "validate rust hello pipeline"
```

Requirements:

- `cargo` available in `PATH`.
