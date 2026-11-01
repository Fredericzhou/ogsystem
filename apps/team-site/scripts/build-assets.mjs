import { build } from "esbuild";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(scriptDirectory, "../public");

await build({
  entryPoints: [join(publicDirectory, "styles.css")],
  outfile: join(publicDirectory, "styles.min.css"),
  bundle: false,
  minify: true,
  legalComments: "none",
  logLevel: "silent"
});

const indexPath = join(publicDirectory, "index.html");
const assetVersions = await Promise.all(["app.js", "styles.min.css", "shell.css"].map(async (name) => {
  const content = await readFile(join(publicDirectory, name));
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return [name, digest];
}));
let index = await readFile(indexPath, "utf8");
for (const [name, digest] of assetVersions) {
  const escapedName = name.replace(".", "\\.");
  index = index.replace(new RegExp(`(href|src)=(['\"])\\/${escapedName}(?:\\?v=[a-f0-9]+)?\\2`, "g"), `$1=$2/${name}?v=${digest}$2`);
}
await writeFile(indexPath, index, "utf8");

process.stdout.write("wrote apps/team-site/public/styles.min.css\n");
