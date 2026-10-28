import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TeamIrDocument } from "./types.js";

export interface TeamArtifactReference {
  artifactId: string;
  mediaType: string;
}

export interface TeamArtifactBlobBackend {
  put(artifactId: string, content: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
  commitOutput(artifactId: string, publicationId: string): Promise<void>;
  get(artifactId: string): Promise<{ content: Uint8Array; metadata: ArtifactMetadata } | undefined>;
  bindRunInput(owner: TeamArtifactOwner, artifactIds: readonly string[]): Promise<void>;
  getRunInputGrant(owner: TeamArtifactOwner): Promise<readonly string[]>;
}

function sameArtifactSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((id, index) => id === rightSorted[index]);
}

export interface TeamArtifactResolver {
  read(artifactId: string): Promise<Uint8Array>;
}

export type TeamArtifactOwner = { projectId: string; runId: string };

export interface ArtifactStore {
  prepareOutput(args: {
    team: TeamIrDocument;
    owner: TeamArtifactOwner;
    agentId: string;
    outputPortId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
    publicationId: string;
  }): Promise<TeamArtifactReference>;
  commitOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void>;
  registerOutput(args: {
    team: TeamIrDocument;
    owner: TeamArtifactOwner;
    agentId: string;
    outputPortId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
  }): Promise<TeamArtifactReference>;
  registerRunInput(args: {
    team: TeamIrDocument;
    projectId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
    authorizeUpload: () => boolean | Promise<boolean>;
  }): Promise<TeamArtifactReference>;
  validateRunInputAttachments(args: { team: TeamIrDocument; projectId: string; attachments: Record<string, unknown> }): Promise<Record<string, TeamArtifactReference>>;
  bindRunInputAttachments(args: { team: TeamIrDocument; owner: TeamArtifactOwner; attachments: Record<string, unknown> }): Promise<Record<string, TeamArtifactReference>>;
  validateReference(args: { team: TeamIrDocument; owner: TeamArtifactOwner; kind: "agent-input" | "agent-output" | "run-result"; agentId?: string; portId?: string; slotId: string; reference: unknown }): Promise<TeamArtifactReference>;
  createInvocationResolver(args: { owner: TeamArtifactOwner; allowedArtifacts: readonly TeamArtifactReference[] }): Promise<TeamArtifactResolver>;
}

export class TeamArtifactError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TeamArtifactError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMediaType(value: string): { type: string; subtype: string } | undefined {
  const [essence] = value.split(";", 1);
  const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)$/.exec(essence.trim().toLowerCase());
  return match ? { type: match[1], subtype: match[2] } : undefined;
}

export function teamArtifactMediaTypeMatches(actual: string, accepted: string): boolean {
  const actualParts = parseMediaType(actual);
  const acceptedParts = parseMediaType(accepted);
  if (!actualParts || !acceptedParts) return false;
  return (acceptedParts.type === "*" || acceptedParts.type === actualParts.type)
    && (acceptedParts.subtype === "*" || acceptedParts.subtype === actualParts.subtype);
}

function getSlot(team: TeamIrDocument, kind: "run-input" | "run-result" | "agent-input" | "agent-output", agentId: string | undefined, portId: string | undefined, slotId: string): Record<string, unknown> {
  let slots: unknown;
  if (kind === "run-input") slots = team.runInput.artifactSlots;
  else if (kind === "run-result") slots = team.runResult.artifactSlots;
  else {
    const agent = team.agents.find((item) => item.id === agentId);
    const ports = kind === "agent-input" ? agent?.inputPorts : agent?.outputPorts;
    const port = ports && isRecord(ports) ? ports[portId ?? ""] : undefined;
    slots = isRecord(port) ? port.artifactSlots : undefined;
  }
  const slot = isRecord(slots) ? slots[slotId] : undefined;
  if (!isRecord(slot)) throw new TeamArtifactError("ARTIFACT_SLOT_UNKNOWN", `Artifact slot '${slotId}' is not declared.`);
  return slot;
}

function assertAcceptedMediaType(mediaType: string, accepted: unknown): void {
  const actual = parseMediaType(mediaType);
  if (!actual || actual.type === "*" || actual.subtype === "*") {
    throw new TeamArtifactError("ARTIFACT_MEDIA_TYPE_INVALID", "Artifact mediaType must name a concrete type and subtype.");
  }
  if (!Array.isArray(accepted) || accepted.length === 0) return;
  if (!accepted.some((item) => typeof item === "string" && teamArtifactMediaTypeMatches(mediaType, item))) {
    throw new TeamArtifactError("ARTIFACT_MEDIA_TYPE_INCOMPATIBLE", "Artifact mediaType is not accepted by the declared slot.");
  }
}

export type ArtifactMetadata = {
  artifactId: string;
  mediaType: string;
  contentDigest: string;
  projectId: string;
  kind: "run-input" | "agent-output";
  runId?: string;
  agentId?: string;
  portId?: string;
  slotId?: string;
  publicationId?: string;
  publicationState?: "prepared" | "committed";
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertOwner(owner: TeamArtifactOwner): void {
  if (!owner || !SAFE_ID.test(owner.projectId) || !SAFE_ID.test(owner.runId)) {
    throw new TeamArtifactError("ARTIFACT_OWNER_INVALID", "Artifact Project and Run ownership is invalid.");
  }
}

function assertProjectId(projectId: string): void {
  if (!SAFE_ID.test(projectId)) throw new TeamArtifactError("ARTIFACT_OWNER_INVALID", "Artifact Project ownership is invalid.");
}

function reference(value: unknown): TeamArtifactReference {
  if (!isRecord(value) || typeof value.artifactId !== "string" || typeof value.mediaType !== "string") {
    throw new TeamArtifactError("ARTIFACT_REFERENCE_INVALID", "Artifact reference must contain artifactId and mediaType.");
  }
  return { artifactId: value.artifactId, mediaType: value.mediaType };
}

function slotFor(team: TeamIrDocument, kind: "agent-input" | "agent-output" | "run-result", agentId: string | undefined, portId: string | undefined, slotId: string): Record<string, unknown> {
  return getSlot(team, kind, agentId, portId, slotId);
}

function validateRequiredSlots(team: TeamIrDocument, attachments: Record<string, unknown>): void {
  const slots = isRecord(team.runInput.artifactSlots) ? team.runInput.artifactSlots : {};
  for (const [slotId, value] of Object.entries(attachments)) {
    if (!Object.prototype.hasOwnProperty.call(slots, slotId)) throw new TeamArtifactError("ARTIFACT_SLOT_UNKNOWN", `Run input Artifact slot '${slotId}' is not declared.`);
    reference(value);
  }
  for (const [slotId, spec] of Object.entries(slots)) {
    if (isRecord(spec) && spec.required === true && !Object.prototype.hasOwnProperty.call(attachments, slotId)) {
      throw new TeamArtifactError("RUN_INPUT_ARTIFACT_REQUIRED", `Required Run input Artifact slot '${slotId}' is missing.`);
    }
  }
}

export class MemoryTeamArtifactBackend implements TeamArtifactBlobBackend {
  private readonly blobs = new Map<string, { content: Uint8Array; metadata: ArtifactMetadata }>();
  private readonly grants = new Map<string, string[]>();

  async put(artifactId: string, content: Uint8Array, metadata: ArtifactMetadata): Promise<void> {
    if (this.blobs.has(artifactId)) throw new TeamArtifactError("ARTIFACT_ID_CONFLICT", "Artifact ID already exists.");
    this.blobs.set(artifactId, { content: Uint8Array.from(content), metadata: structuredClone(metadata) });
  }

  async commitOutput(artifactId: string, publicationId: string): Promise<void> {
    const stored = this.blobs.get(artifactId);
    if (!stored || stored.metadata.publicationId !== publicationId) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication intent does not match.");
    stored.metadata.publicationState = "committed";
  }

  async get(artifactId: string): Promise<{ content: Uint8Array; metadata: ArtifactMetadata } | undefined> {
    const stored = this.blobs.get(artifactId);
    return stored ? { content: Uint8Array.from(stored.content), metadata: structuredClone(stored.metadata) } : undefined;
  }

  async bindRunInput(owner: TeamArtifactOwner, artifactIds: readonly string[]): Promise<void> {
    const key = `${owner.projectId}:${owner.runId}`;
    const current = this.grants.get(key);
    if (current && !sameArtifactSet(current, artifactIds)) {
      throw new TeamArtifactError("ARTIFACT_RUN_INPUT_CONFLICT", "Run input Artifact grant is immutable once bound.");
    }
    if (!current) this.grants.set(key, [...artifactIds]);
  }

  async getRunInputGrant(owner: TeamArtifactOwner): Promise<readonly string[]> {
    return [...(this.grants.get(`${owner.projectId}:${owner.runId}`) ?? [])];
  }
}

/** Opaque Artifact references are public; storage keys and blob locations stay behind this boundary. */
export class TeamArtifactStore implements ArtifactStore {
  private readonly metadata = new Map<string, ArtifactMetadata>();
  private readonly runInputGrants = new Map<string, Set<string>>();

  constructor(private readonly args: { backend: TeamArtifactBlobBackend }) {}

  async registerOutput(args: {
    team: TeamIrDocument;
    owner: TeamArtifactOwner;
    agentId: string;
    outputPortId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
  }): Promise<TeamArtifactReference> {
    const publicationId = randomUUID();
    const ref = await this.prepareOutput({ ...args, publicationId });
    await this.commitOutput({ owner: args.owner, reference: ref, publicationId });
    return ref;
  }

  async prepareOutput(args: {
    team: TeamIrDocument;
    owner: TeamArtifactOwner;
    agentId: string;
    outputPortId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
    publicationId: string;
  }): Promise<TeamArtifactReference> {
    assertOwner(args.owner);
    if (!SAFE_ID.test(args.publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication ID is invalid.");
    const slot = getSlot(args.team, "agent-output", args.agentId, args.outputPortId, args.slotId);
    assertAcceptedMediaType(args.mediaType, slot.mediaTypes);
    return this.register(args.mediaType, args.content, {
      projectId: args.owner.projectId, runId: args.owner.runId, kind: "agent-output",
      agentId: args.agentId, portId: args.outputPortId, slotId: args.slotId,
      publicationId: args.publicationId, publicationState: "prepared"
    });
  }

  async commitOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void> {
    assertOwner(args.owner);
    const ref = reference(args.reference);
    await this.args.backend.commitOutput(ref.artifactId, args.publicationId);
    const metadata = (await this.args.backend.get(ref.artifactId))?.metadata;
    if (!metadata || metadata.projectId !== args.owner.projectId || metadata.runId !== args.owner.runId || metadata.publicationState !== "committed") {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication did not commit for this Run.");
    }
  }

  async registerRunInput(args: {
    team: TeamIrDocument;
    projectId: string;
    slotId: string;
    mediaType: string;
    content: Uint8Array;
    authorizeUpload: () => boolean | Promise<boolean>;
  }): Promise<TeamArtifactReference> {
    assertProjectId(args.projectId);
    const slot = getSlot(args.team, "run-input", undefined, undefined, args.slotId);
    if (!(await args.authorizeUpload())) throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Caller is not allowed to register this Run input Artifact.");
    assertAcceptedMediaType(args.mediaType, slot.acceptedMediaTypes);
    return this.register(args.mediaType, args.content, { projectId: args.projectId, kind: "run-input", slotId: args.slotId });
  }

  private async register(mediaType: string, content: Uint8Array, ownership: Omit<ArtifactMetadata, "artifactId" | "mediaType" | "contentDigest">): Promise<TeamArtifactReference> {
    if (!(content instanceof Uint8Array)) throw new TeamArtifactError("ARTIFACT_CONTENT_INVALID", "Artifact content must be bytes.");
    const bytes = Uint8Array.from(content);
    const contentDigest = createHash("sha256").update(bytes).digest("hex");
    const artifactId = `art_${randomUUID()}`;
    const metadata = { artifactId, mediaType, contentDigest, ...ownership };
    await this.args.backend.put(artifactId, bytes, metadata);
    this.metadata.set(artifactId, metadata);
    return Object.freeze({ artifactId, mediaType });
  }

  async bindRunInputAttachments(args: { team: TeamIrDocument; owner: TeamArtifactOwner; attachments: Record<string, unknown> }): Promise<Record<string, TeamArtifactReference>> {
    assertOwner(args.owner);
    const normalized = await this.validateRunInputAttachments({ team: args.team, projectId: args.owner.projectId, attachments: args.attachments });
    this.runInputGrants.set(`${args.owner.projectId}:${args.owner.runId}`, new Set(Object.values(normalized).map((item) => item.artifactId)));
    await this.args.backend.bindRunInput(args.owner, Object.values(normalized).map((item) => item.artifactId));
    return normalized;
  }

  async validateRunInputAttachments(args: { team: TeamIrDocument; projectId: string; attachments: Record<string, unknown> }): Promise<Record<string, TeamArtifactReference>> {
    assertProjectId(args.projectId);
    validateRequiredSlots(args.team, args.attachments);
    const normalized: Record<string, TeamArtifactReference> = {};
    for (const [slotId, value] of Object.entries(args.attachments)) {
      const slot = getSlot(args.team, "run-input", undefined, undefined, slotId);
      if (slot.cardinality !== "single") throw new TeamArtifactError("ARTIFACT_CARDINALITY_UNSUPPORTED", "Project Task inputs currently support only single Artifact slots.");
      const ref = reference(value);
      const metadata = (await this.args.backend.get(ref.artifactId))?.metadata;
      if (!metadata || metadata.projectId !== args.projectId || metadata.kind !== "run-input" || metadata.slotId !== slotId || metadata.mediaType !== ref.mediaType) {
        throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Run input Artifact is not registered for this Project and slot.");
      }
      assertAcceptedMediaType(metadata.mediaType, slot.acceptedMediaTypes);
      normalized[slotId] = { artifactId: metadata.artifactId, mediaType: metadata.mediaType };
    }
    return normalized;
  }

  async validateReference(args: { team: TeamIrDocument; owner: TeamArtifactOwner; kind: "agent-input" | "agent-output" | "run-result"; agentId?: string; portId?: string; slotId: string; reference: unknown }): Promise<TeamArtifactReference> {
    assertOwner(args.owner);
    const ref = reference(args.reference);
    const slot = slotFor(args.team, args.kind, args.agentId, args.portId, args.slotId);
    const metadata = (await this.args.backend.get(ref.artifactId))?.metadata;
    const runInputGrant = await this.args.backend.getRunInputGrant(args.owner);
    if (!metadata || metadata.projectId !== args.owner.projectId || metadata.mediaType !== ref.mediaType) {
      throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Artifact reference does not belong to this Project.");
    }
    if (args.kind === "agent-output") {
      if (metadata.kind !== "agent-output" || metadata.runId !== args.owner.runId || metadata.agentId !== args.agentId || metadata.portId !== args.portId || metadata.slotId !== args.slotId || metadata.publicationState !== "committed") {
        throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Artifact was not registered by the declared Agent output slot in this Run.");
      }
      assertAcceptedMediaType(metadata.mediaType, slot.mediaTypes);
    } else if (args.kind === "run-result") {
      if (metadata.kind !== "agent-output" || metadata.runId !== args.owner.runId || metadata.publicationState !== "committed") throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Run result Artifact must be committed in this Run.");
      assertAcceptedMediaType(metadata.mediaType, slot.acceptedMediaTypes);
    } else {
      const isRunInput = metadata.kind === "run-input" && metadata.slotId && runInputGrant.includes(metadata.artifactId);
      const isCurrentRunOutput = metadata.kind === "agent-output" && metadata.runId === args.owner.runId && metadata.publicationState === "committed";
      if (!isRunInput && !isCurrentRunOutput) {
        throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Artifact is not authorized for this Agent input slot and Run.");
      }
      assertAcceptedMediaType(metadata.mediaType, slot.acceptedMediaTypes);
    }
    return { artifactId: metadata.artifactId, mediaType: metadata.mediaType };
  }

  async createInvocationResolver(args: { owner: TeamArtifactOwner; allowedArtifacts: readonly TeamArtifactReference[] }): Promise<TeamArtifactResolver> {
    assertOwner(args.owner);
    const allowlist = new Map<string, string>();
    const inputGrant = await this.args.backend.getRunInputGrant(args.owner);
    for (const item of args.allowedArtifacts) {
      const metadata = (await this.args.backend.get(item.artifactId))?.metadata;
      const isRunInputGrant = inputGrant.includes(item.artifactId);
      const sameRunOutput = metadata?.kind === "agent-output" && metadata.projectId === args.owner.projectId && metadata.runId === args.owner.runId && metadata.publicationState === "committed";
      if (!metadata || metadata.projectId !== args.owner.projectId || metadata.mediaType !== item.mediaType || (!isRunInputGrant && !sameRunOutput)) {
        throw new TeamArtifactError("ARTIFACT_REFERENCE_INVALID", "Invocation Artifact reference is unknown or has conflicting metadata.");
      }
      allowlist.set(item.artifactId, metadata.contentDigest);
    }
    return Object.freeze({
      read: async (artifactId: string): Promise<Uint8Array> => {
        const expectedDigest = allowlist.get(artifactId);
        if (!expectedDigest) throw new TeamArtifactError("ARTIFACT_ACCESS_DENIED", "Artifact is outside this invocation's Allowed Artifact Set.");
        const stored = await this.args.backend.get(artifactId);
        if (!stored) throw new TeamArtifactError("ARTIFACT_NOT_FOUND", "Authorized Artifact content is unavailable.");
        const actualDigest = createHash("sha256").update(stored.content).digest("hex");
        if (actualDigest !== expectedDigest) throw new TeamArtifactError("ARTIFACT_INTEGRITY_FAILED", "Artifact content failed integrity verification.");
        return Uint8Array.from(stored.content);
      }
    });
  }

  async getReference(artifactId: string): Promise<TeamArtifactReference | undefined> {
    const metadata = (await this.args.backend.get(artifactId))?.metadata;
    return metadata && (metadata.kind === "run-input" || metadata.publicationState === "committed")
      ? Object.freeze({ artifactId: metadata.artifactId, mediaType: metadata.mediaType }) : undefined;
  }
}

function artifactId(value: string): string {
  if (!/^art_[A-Za-z0-9_-]{36}$/.test(value)) throw new TeamArtifactError("ARTIFACT_ID_INVALID", "Artifact ID is invalid.");
  return value;
}

export class FileTeamArtifactStore extends TeamArtifactStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    const root = resolve(rootDirectory);
    const indexPath = (id: string) => join(root, "index", `${artifactId(id)}.json`);
    const ownerDirectory = (metadata: ArtifactMetadata) => metadata.kind === "run-input"
      ? join(root, "projects", metadata.projectId, "input-artifacts")
      : join(root, "projects", metadata.projectId, "runs", metadata.runId!, "artifacts");
    const blobPath = (metadata: ArtifactMetadata) => join(ownerDirectory(metadata), `${artifactId(metadata.artifactId)}.bin`);
    const writeAtomic = async (path: string, content: string | Uint8Array): Promise<void> => {
      await mkdir(resolve(path, ".."), { recursive: true });
      const tempPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, content, { flag: "wx" });
        await rename(tempPath, path);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    };
    const writeOnceAtomic = async (path: string, content: string | Uint8Array): Promise<boolean> => {
      await mkdir(resolve(path, ".."), { recursive: true });
      const tempPath = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, content, { flag: "wx" });
        try {
          await link(tempPath, path);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw error;
        }
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined);
      }
    };
    const backend: TeamArtifactBlobBackend = {
      put: async (id, content, metadata) => {
        artifactId(id);
        assertProjectId(metadata.projectId);
        if (metadata.kind === "agent-output") assertOwner({ projectId: metadata.projectId, runId: metadata.runId ?? "" });
        const path = blobPath(metadata);
        await mkdir(resolve(path, ".."), { recursive: true });
        await writeFile(path, content, { flag: "wx" });
        await writeAtomic(indexPath(id), JSON.stringify({ metadata, contentPath: path }));
      },
      commitOutput: async (id, publicationId) => {
        const stored = await backend.get(id);
        if (!stored || stored.metadata.publicationId !== publicationId) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication intent does not match.");
        if (stored.metadata.publicationState === "committed") return;
        const path = indexPath(id);
        await writeAtomic(path, JSON.stringify({ metadata: { ...stored.metadata, publicationState: "committed" }, contentPath: blobPath(stored.metadata) }));
      },
      get: async (id) => {
        artifactId(id);
        try {
          const record = JSON.parse(await readFile(indexPath(id), "utf8")) as { metadata?: ArtifactMetadata; contentPath?: string };
          if (!record.metadata || record.metadata.artifactId !== id || record.contentPath !== blobPath(record.metadata)) {
            throw new TeamArtifactError("ARTIFACT_METADATA_INVALID", "Artifact metadata failed path validation.");
          }
          return { metadata: record.metadata, content: new Uint8Array(await readFile(record.contentPath)) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }
      },
      bindRunInput: async (owner, ids) => {
        assertOwner(owner);
        const path = join(root, "projects", owner.projectId, "runs", owner.runId, "input-artifacts.json");
        const manifest = JSON.stringify({ projectId: owner.projectId, runId: owner.runId, artifactIds: [...ids] });
        const created = await writeOnceAtomic(path, manifest);
        if (created) return;
        const existing = await readFile(path, "utf8");
        const parsed = JSON.parse(existing) as { projectId?: string; runId?: string; artifactIds?: unknown };
        if (parsed.projectId !== owner.projectId || parsed.runId !== owner.runId || !Array.isArray(parsed.artifactIds)
          || !parsed.artifactIds.every((id): id is string => typeof id === "string") || !sameArtifactSet(parsed.artifactIds, ids)) {
          throw new TeamArtifactError("ARTIFACT_RUN_INPUT_CONFLICT", "Run input Artifact grant is immutable once bound.");
        }
      },
      getRunInputGrant: async (owner) => {
        assertOwner(owner);
        const path = join(root, "projects", owner.projectId, "runs", owner.runId, "input-artifacts.json");
        try {
          const manifest = JSON.parse(await readFile(path, "utf8")) as { projectId?: string; runId?: string; artifactIds?: unknown };
          if (manifest.projectId !== owner.projectId || manifest.runId !== owner.runId || !Array.isArray(manifest.artifactIds)
            || manifest.artifactIds.some((id) => typeof id !== "string")) {
            throw new TeamArtifactError("ARTIFACT_GRANT_INVALID", "Run input Artifact grant failed ownership validation.");
          }
          return manifest.artifactIds as string[];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      }
    };
    super({ backend });
    this.rootDirectory = root;
  }
}
