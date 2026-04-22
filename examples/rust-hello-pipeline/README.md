# Rust Hello Pipeline

Three-role full-flow validation example:

1. `rust-developer`: generate Rust `hello world` project.
2. `rust-compiler`: compile with Cargo release profile.
3. `rust-packager`: package binary and run it for output verification.

Run command:

```bash
ogs run start \
  --system examples/rust-hello-pipeline/system.mmd \
  --laws .ogs/laws.json \
  --workdir examples/rust-hello-pipeline \
  --input "validate rust hello pipeline"
```

Requirements:

- `cargo` available in `PATH`.
