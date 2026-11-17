import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ID = /^[a-z0-9][a-z0-9._-]{1,95}$/;

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function publish(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function assertTemplateId(value) {
  const id = String(value || "").trim();
  if (!ID.test(id)) throw new Error("HARNESS_TEMPLATE_ID_INVALID");
  return id;
}

export function createFileHarnessRepositoryStore({ path, now = () => new Date().toISOString() }) {
  if (!path) throw new TypeError("Harness repository path is required.");
  let mutation = Promise.resolve();
  const serialize = async (operation) => {
    const previous = mutation;
    let release;
    mutation = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  };
  const readCatalog = async () => {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.templates)) throw new Error("HARNESS_REPOSITORY_INVALID");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, templates: [] };
      throw error;
    }
  };
  const current = (entry) => entry?.revisions?.find((revision) => revision.revision === entry.currentRevision) || entry;
  return Object.freeze({
    async list({ includeArchived = false } = {}) {
      const catalog = await readCatalog();
      return catalog.templates
        .map((entry) => ({ ...clone(entry), ...clone(current(entry)) }))
        .filter((entry) => includeArchived || entry.status !== "archived")
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async get(templateId, revision) {
      const id = assertTemplateId(templateId);
      const catalog = await readCatalog();
      const entry = catalog.templates.find((item) => item.templateId === id);
      if (!entry) return undefined;
      const selected = revision ? entry.revisions?.find((item) => item.revision === Number(revision)) : current(entry);
      return selected ? { ...clone(entry), ...clone(selected), revisions: undefined } : undefined;
    },
    async save(input) {
      const id = assertTemplateId(input?.templateId);
      if (!input?.template || input.template.templateId !== id) throw new Error("HARNESS_TEMPLATE_INVALID");
      return serialize(async () => {
        const catalog = await readCatalog();
        const at = now();
        const index = catalog.templates.findIndex((entry) => entry.templateId === id);
        const previous = index >= 0 ? catalog.templates[index] : undefined;
        const revision = Number(previous?.currentRevision || 0) + 1;
        const record = {
          templateId: id,
          name: String(input.name || id).trim().slice(0, 160),
          description: String(input.description || "").trim().slice(0, 1000),
          currentRevision: revision,
          createdAt: previous?.createdAt || at,
          updatedAt: at,
          revisions: [ ...(previous?.revisions || []), {
            revision,
            template: clone(input.template),
            status: input.initialVerification?.status === "verified" ? "verified" : "draft",
            digest: digest(input.template),
            ...(input.initialVerification ? {
              verification: clone(input.initialVerification),
              verifiedAt: input.initialVerification.verifiedAt,
              verifiedTools: [...(input.initialVerification.verifiedTools || [])]
            } : {}),
            createdAt: at,
            updatedAt: at
          } ]
        };
        if (index >= 0) catalog.templates[index] = record; else catalog.templates.push(record);
        await publish(path, catalog);
        return { ...clone(record), ...clone(current(record)), revisions: undefined };
      });
    },
    async updateVerification(templateId, revision, verification) {
      const id = assertTemplateId(templateId);
      return serialize(async () => {
        const catalog = await readCatalog();
        const entry = catalog.templates.find((item) => item.templateId === id);
        if (!entry) throw new Error("HARNESS_TEMPLATE_NOT_FOUND");
        const selected = entry.revisions?.find((item) => item.revision === Number(revision));
        if (!selected || entry.currentRevision !== Number(revision)) throw new Error("HARNESS_TEMPLATE_REVISION_STALE");
        selected.status = verification.status;
        selected.verification = clone(verification);
        selected.verifiedAt = verification.verifiedAt;
        selected.verifiedTools = [...(verification.verifiedTools || [])];
        selected.updatedAt = now();
        entry.updatedAt = selected.updatedAt;
        await publish(path, catalog);
        return { ...clone(entry), ...clone(selected), revisions: undefined };
      });
    },
    async archive(templateId) {
      const id = assertTemplateId(templateId);
      return serialize(async () => {
        const catalog = await readCatalog();
        const entry = catalog.templates.find((item) => item.templateId === id);
        if (!entry) throw new Error("HARNESS_TEMPLATE_NOT_FOUND");
        const selected = current(entry);
        selected.status = "archived";
        selected.updatedAt = now();
        entry.updatedAt = selected.updatedAt;
        await publish(path, catalog);
        return { ...clone(entry), ...clone(selected), revisions: undefined };
      });
    }
  });
}

export { digest as harnessTemplateDigest };
