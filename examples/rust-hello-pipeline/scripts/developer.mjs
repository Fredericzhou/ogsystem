import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sharedDir = process.env.OGSYSTEM_SHARED_DIR;
if (!sharedDir) {
  process.stderr.write("missing OGSYSTEM_SHARED_DIR\n");
  process.exit(1);
}

const projectDir = path.resolve(sharedDir, "rust-hello");
const srcDir = path.resolve(projectDir, "src");
await mkdir(srcDir, { recursive: true });

await writeFile(
  path.resolve(projectDir, "Cargo.toml"),
  [
    "[package]",
    'name = "hello_ogsystem"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    ""
  ].join("\n"),
  "utf8"
);

await writeFile(
  path.resolve(srcDir, "main.rs"),
  [
    "fn main() {",
    '    println!("hello from OGSystem rust pipeline");',
    "}",
    ""
  ].join("\n"),
  "utf8"
);

process.stdout.write(
  JSON.stringify({
    event: "DEVELOP_DONE",
    content: `Rust project created at ${projectDir}`,
    data: {
      projectDir
    }
  })
);
