import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TeamIrDocument } from "./types.js";

export interface TeamArtifactReference {
  artifactId: string;
  mediaType: string;
}

export interface TeamArtifactBlobBackend {
  reservePublication(owner: TeamArtifactOwner, invocationId: string, publicationId: string): Promise<TeamArtifactPublicationReservation>;
  activatePublication(reservation: TeamArtifactPublicationReservation, artifactIds: readonly string[]): Promise<void>;
  finishPublication(reservation: TeamArtifactPublicationReservation): Promise<void>;
  abortPublication(reservation: TeamArtifactPublicationReservation): Promise<void>;
  recoverPublications(owner: TeamArtifactOwner, retainedPublicationIds: readonly string[], liveInvocationIds: readonly string[]): Promise<TeamArtifactPublicationRecovery[]>;
  put(artifactId: string, content: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
  commitOutput(artifactId: string, publicationId: string, fencingGeneration?: number): Promise<void>;
  abortOutput(artifactId: string, expected: ArtifactMetadata): Promise<void>;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export interface TeamArtifactResolver {
  read(artifactId: string): Promise<Uint8Array>;
}

export type TeamArtifactOwner = { projectId: string; runId: string };

export type TeamArtifactPublicationReservation = TeamArtifactOwner & {
  invocationId: string;
  publicationId: string;
  fencingGeneration: number;
};

export type TeamArtifactPublicationState = "reserved" | "pending" | "committed" | "aborted";

export type TeamArtifactPublicationRecovery = {
  reservation: TeamArtifactPublicationReservation;
  state: TeamArtifactPublicationState;
  artifactIds: string[];
};

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
    invocationId?: string;
    reservation?: TeamArtifactPublicationReservation;
  }): Promise<TeamArtifactReference>;
  commitOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void>;
  abortOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void>;
  reserveOutputPublication(args: { owner: TeamArtifactOwner; invocationId: string; publicationId: string }): Promise<TeamArtifactPublicationReservation>;
  activateOutputPublication(args: { reservation: TeamArtifactPublicationReservation; references: readonly TeamArtifactReference[] }): Promise<void>;
  finishOutputPublication(args: { reservation: TeamArtifactPublicationReservation }): Promise<void>;
  abortOutputPublication(args: { reservation: TeamArtifactPublicationReservation }): Promise<void>;
  recoverOutputPublications(args: { owner: TeamArtifactOwner; retainedPublicationIds: readonly string[]; liveInvocationIds: readonly string[] }): Promise<TeamArtifactPublicationRecovery[]>;
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
  invocationId?: string;
  fencingGeneration?: number;
};

type StoredPublicationReservation = TeamArtifactPublicationReservation & {
  state: TeamArtifactPublicationState;
  artifacts: Record<string, ArtifactMetadata>;
};

function reservationKey(owner: TeamArtifactOwner, publicationId: string): string {
  return `${owner.projectId}:${owner.runId}:${publicationId}`;
}

function assertReservationToken(expected: TeamArtifactPublicationReservation, actual: StoredPublicationReservation): void {
  if (expected.projectId !== actual.projectId || expected.runId !== actual.runId || expected.invocationId !== actual.invocationId
    || expected.publicationId !== actual.publicationId || expected.fencingGeneration !== actual.fencingGeneration) {
    throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact publication reservation token is stale or belongs to another publication.");
  }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_INVOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function assertOwner(owner: TeamArtifactOwner): void {
  if (!owner || !SAFE_ID.test(owner.projectId) || !SAFE_ID.test(owner.runId)) {
    throw new TeamArtifactError("ARTIFACT_OWNER_INVALID", "Artifact Project and Run ownership is invalid.");
  }
}

function assertProjectId(projectId: string): void {
  if (!SAFE_ID.test(projectId)) throw new TeamArtifactError("ARTIFACT_OWNER_INVALID", "Artifact Project ownership is invalid.");
}

function assertInvocationId(invocationId: string): void {
  if (!SAFE_INVOCATION_ID.test(invocationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact invocation ID is invalid.");
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
  private readonly publications = new Map<string, StoredPublicationReservation>();

  async reservePublication(owner: TeamArtifactOwner, invocationId: string, publicationId: string): Promise<TeamArtifactPublicationReservation> {
    assertOwner(owner);
    assertInvocationId(invocationId);
    if (!SAFE_ID.test(publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication identity is invalid.");
    const key = reservationKey(owner, publicationId);
    const existing = this.publications.get(key);
    if (existing) {
      if (existing.invocationId !== invocationId || existing.state !== "reserved") {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_CONFLICT", "Artifact publication ID is already reserved or terminal.");
      }
      return { projectId: existing.projectId, runId: existing.runId, invocationId: existing.invocationId, publicationId: existing.publicationId, fencingGeneration: existing.fencingGeneration };
    }
    const reservation = { ...owner, invocationId, publicationId, fencingGeneration: 1, state: "reserved" as const, artifacts: {} };
    this.publications.set(key, reservation);
    return { projectId: owner.projectId, runId: owner.runId, invocationId, publicationId, fencingGeneration: reservation.fencingGeneration };
  }

  async activatePublication(reservation: TeamArtifactPublicationReservation, artifactIds: readonly string[]): Promise<void> {
    const stored = this.publications.get(reservationKey(reservation, reservation.publicationId));
    if (!stored) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing.");
    assertReservationToken(reservation, stored);
    if (stored.state === "pending") return;
    if (stored.state !== "reserved" || !sameArtifactSet(Object.keys(stored.artifacts), artifactIds)) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication cannot be activated with these references.");
    }
    stored.state = "pending";
  }

  async finishPublication(reservation: TeamArtifactPublicationReservation): Promise<void> {
    const stored = this.publications.get(reservationKey(reservation, reservation.publicationId));
    if (!stored) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing.");
    assertReservationToken(reservation, stored);
    if (stored.state === "committed") return;
    if (stored.state !== "pending" || Object.keys(stored.artifacts).some((id) => this.blobs.get(id)?.metadata.publicationState !== "committed")) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication is not fully committed.");
    }
    stored.state = "committed";
  }

  async abortPublication(reservation: TeamArtifactPublicationReservation): Promise<void> {
    const stored = this.publications.get(reservationKey(reservation, reservation.publicationId));
    if (!stored) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing.");
    assertReservationToken(reservation, stored);
    if (stored.state === "committed" || Object.keys(stored.artifacts).some((id) => this.blobs.get(id)?.metadata.publicationState === "committed")) {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Committed Artifact publications cannot be aborted.");
    }
    stored.state = "aborted";
    stored.fencingGeneration += 1;
    for (const id of Object.keys(stored.artifacts)) this.blobs.delete(id);
  }

  async recoverPublications(owner: TeamArtifactOwner, retainedPublicationIds: readonly string[], liveInvocationIds: readonly string[]): Promise<TeamArtifactPublicationRecovery[]> {
    const publications = [...this.publications.values()].filter((item) => item.projectId === owner.projectId && item.runId === owner.runId);
    for (const id of retainedPublicationIds) {
      const retained = publications.find((item) => item.publicationId === id);
      if (!retained || retained.state === "aborted") throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "A retained Run publication has no active Artifact reservation.");
    }
    for (const item of publications) {
      if (retainedPublicationIds.includes(item.publicationId) || liveInvocationIds.includes(item.invocationId) || item.state === "committed"
        || Object.keys(item.artifacts).some((id) => this.blobs.get(id)?.metadata.publicationState === "committed")) continue;
      if (item.state !== "aborted") {
        item.state = "aborted";
        item.fencingGeneration += 1;
      }
      for (const id of Object.keys(item.artifacts)) this.blobs.delete(id);
    }
    return publications.map((item) => ({
      reservation: { projectId: item.projectId, runId: item.runId, invocationId: item.invocationId, publicationId: item.publicationId, fencingGeneration: item.fencingGeneration },
      state: item.state,
      artifactIds: Object.keys(item.artifacts)
    }));
  }

  async put(artifactId: string, content: Uint8Array, metadata: ArtifactMetadata): Promise<void> {
    if (this.blobs.has(artifactId)) throw new TeamArtifactError("ARTIFACT_ID_CONFLICT", "Artifact ID already exists.");
    if (metadata.kind === "agent-output") {
      const stored = this.publications.get(reservationKey({ projectId: metadata.projectId, runId: metadata.runId! }, metadata.publicationId!));
      if (!stored || stored.state !== "reserved" || stored.invocationId !== metadata.invocationId
        || stored.fencingGeneration !== metadata.fencingGeneration) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact output has no active matching reservation.");
      }
      stored.artifacts[artifactId] = structuredClone(metadata);
    }
    this.blobs.set(artifactId, { content: Uint8Array.from(content), metadata: structuredClone(metadata) });
  }

  async commitOutput(artifactId: string, publicationId: string): Promise<void> {
    const stored = this.blobs.get(artifactId);
    if (!stored || stored.metadata.publicationId !== publicationId) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication intent does not match.");
    const publication = this.publications.get(reservationKey({ projectId: stored.metadata.projectId, runId: stored.metadata.runId! }, publicationId));
    if (!publication || publication.state !== "pending"
      || publication.fencingGeneration !== stored.metadata.fencingGeneration || !publication.artifacts[artifactId]) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact publication reservation is not writable.");
    }
    stored.metadata.publicationState = "committed";
  }

  async abortOutput(artifactId: string, expected: ArtifactMetadata): Promise<void> {
    const stored = this.blobs.get(artifactId);
    if (!stored) return;
    if (stored.metadata.kind !== "agent-output" || stored.metadata.publicationState !== "prepared"
      || stored.metadata.publicationId !== expected.publicationId || stored.metadata.projectId !== expected.projectId
      || stored.metadata.runId !== expected.runId || stored.metadata.fencingGeneration !== expected.fencingGeneration) {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Only the matching prepared Artifact publication can be aborted.");
    }
    const publication = this.publications.get(reservationKey({ projectId: expected.projectId, runId: expected.runId! }, expected.publicationId!));
    if (!publication) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing.");
    assertReservationToken({ projectId: expected.projectId, runId: expected.runId!, invocationId: expected.invocationId!, publicationId: expected.publicationId!, fencingGeneration: expected.fencingGeneration! }, publication);
    if (publication.state === "committed" || Object.keys(publication.artifacts).some((id) => this.blobs.get(id)?.metadata.publicationState === "committed")) {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Committed Artifact publications cannot be aborted.");
    }
    publication.state = "aborted";
    publication.fencingGeneration += 1;
    for (const id of Object.keys(publication.artifacts)) this.blobs.delete(id);
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
    const reservation = await this.reserveOutputPublication({ owner: args.owner, invocationId: `output-${publicationId}`, publicationId });
    const ref = await this.prepareOutput({ ...args, publicationId, reservation });
    await this.activateOutputPublication({ reservation, references: [ref] });
    await this.commitOutput({ owner: args.owner, reference: ref, publicationId });
    await this.finishOutputPublication({ reservation });
    return ref;
  }

  async reserveOutputPublication(args: { owner: TeamArtifactOwner; invocationId: string; publicationId: string }): Promise<TeamArtifactPublicationReservation> {
    assertOwner(args.owner);
    assertInvocationId(args.invocationId);
    if (!SAFE_ID.test(args.publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication identity is invalid.");
    return this.args.backend.reservePublication(args.owner, args.invocationId, args.publicationId);
  }

  async activateOutputPublication(args: { reservation: TeamArtifactPublicationReservation; references: readonly TeamArtifactReference[] }): Promise<void> {
    await this.args.backend.activatePublication(args.reservation, args.references.map((item) => reference(item).artifactId));
  }

  async finishOutputPublication(args: { reservation: TeamArtifactPublicationReservation }): Promise<void> {
    await this.args.backend.finishPublication(args.reservation);
  }

  async abortOutputPublication(args: { reservation: TeamArtifactPublicationReservation }): Promise<void> {
    await this.args.backend.abortPublication(args.reservation);
    for (const [id, metadata] of this.metadata) {
      if (metadata.projectId === args.reservation.projectId && metadata.runId === args.reservation.runId
        && metadata.publicationId === args.reservation.publicationId) this.metadata.delete(id);
    }
  }

  async recoverOutputPublications(args: { owner: TeamArtifactOwner; retainedPublicationIds: readonly string[]; liveInvocationIds: readonly string[] }): Promise<TeamArtifactPublicationRecovery[]> {
    assertOwner(args.owner);
    if (new Set(args.retainedPublicationIds).size !== args.retainedPublicationIds.length
      || args.retainedPublicationIds.some((id) => !SAFE_ID.test(id))) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Retained Artifact publication IDs are invalid.");
    }
    if (args.liveInvocationIds.some((id) => !SAFE_INVOCATION_ID.test(id))) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Live invocation IDs are invalid.");
    return this.args.backend.recoverPublications(args.owner, args.retainedPublicationIds, args.liveInvocationIds);
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
    invocationId?: string;
    reservation?: TeamArtifactPublicationReservation;
  }): Promise<TeamArtifactReference> {
    assertOwner(args.owner);
    if (!SAFE_ID.test(args.publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication ID is invalid.");
    const reservation = args.reservation ?? await this.reserveOutputPublication({ owner: args.owner, invocationId: args.invocationId ?? `publication-${args.publicationId}`, publicationId: args.publicationId });
    if (reservation.projectId !== args.owner.projectId || reservation.runId !== args.owner.runId || reservation.publicationId !== args.publicationId
      || (args.invocationId !== undefined && reservation.invocationId !== args.invocationId)) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact output reservation does not match its owner or invocation.");
    }
    const slot = getSlot(args.team, "agent-output", args.agentId, args.outputPortId, args.slotId);
    assertAcceptedMediaType(args.mediaType, slot.mediaTypes);
    return this.register(args.mediaType, args.content, {
      projectId: args.owner.projectId, runId: args.owner.runId, kind: "agent-output",
      agentId: args.agentId, portId: args.outputPortId, slotId: args.slotId,
      publicationId: args.publicationId, publicationState: "prepared",
      invocationId: reservation.invocationId, fencingGeneration: reservation.fencingGeneration
    });
  }

  async commitOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void> {
    assertOwner(args.owner);
    const ref = reference(args.reference);
    const before = await this.args.backend.get(ref.artifactId);
    const metadataBefore = before?.metadata ?? this.metadata.get(ref.artifactId);
    if (!before && !metadataBefore) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Prepared Artifact publication no longer exists.");
    if (!metadataBefore || metadataBefore.projectId !== args.owner.projectId || metadataBefore.runId !== args.owner.runId
      || metadataBefore.publicationId !== args.publicationId || !metadataBefore.invocationId || !metadataBefore.fencingGeneration) {
      throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation metadata is missing or invalid.");
    }
    await this.args.backend.commitOutput(ref.artifactId, args.publicationId, metadataBefore.fencingGeneration);
    const metadata = (await this.args.backend.get(ref.artifactId))?.metadata;
    if (!metadata || metadata.projectId !== args.owner.projectId || metadata.runId !== args.owner.runId || metadata.publicationState !== "committed") {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication did not commit for this Run.");
    }
  }

  async abortOutput(args: { owner: TeamArtifactOwner; reference: TeamArtifactReference; publicationId: string }): Promise<void> {
    assertOwner(args.owner);
    if (!SAFE_ID.test(args.publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication ID is invalid.");
    const ref = reference(args.reference);
    const stored = await this.args.backend.get(ref.artifactId);
    const metadata = stored?.metadata ?? this.metadata.get(ref.artifactId);
    if (!metadata) return;
    if (metadata.kind !== "agent-output" || metadata.projectId !== args.owner.projectId || metadata.runId !== args.owner.runId
      || metadata.publicationId !== args.publicationId || metadata.publicationState !== "prepared") {
      throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Only the matching prepared Artifact publication can be aborted.");
    }
    await this.args.backend.abortOutput(ref.artifactId, metadata);
    this.metadata.delete(ref.artifactId);
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
    this.metadata.set(artifactId, metadata);
    try {
      await this.args.backend.put(artifactId, bytes, metadata);
    } catch (error) {
      if (metadata.kind === "agent-output" && metadata.publicationId && this.args.backend.abortOutput) {
        await this.args.backend.abortOutput(artifactId, metadata).catch(() => undefined);
      }
      this.metadata.delete(artifactId);
      throw error;
    }
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
    const publicationPath = (owner: TeamArtifactOwner, publicationId: string) => join(root, "projects", owner.projectId, "runs", owner.runId, "publications", `${publicationId}.json`);
    const publicationLockPath = (owner: TeamArtifactOwner, publicationId: string) => join(root, "locks", owner.projectId, owner.runId, `${publicationId}.lock`);
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
    const withPublicationLock = async <T>(owner: TeamArtifactOwner, publicationId: string, operation: () => Promise<T>): Promise<T> => {
      assertOwner(owner);
      if (!SAFE_ID.test(publicationId)) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication ID is invalid.");
      const lockPath = publicationLockPath(owner, publicationId);
      const deadline = Date.now() + 10_000;
      await mkdir(resolve(lockPath, ".."), { recursive: true });
      while (true) {
        try {
          await mkdir(lockPath, { recursive: false });
          try {
            await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token: randomUUID() }), { flag: "wx" });
          } catch (error) {
            await rm(lockPath, { recursive: true, force: true });
            throw error;
          }
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          let lockOwner: { pid?: number } | undefined;
          try {
            lockOwner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { pid?: number };
          } catch (readError) {
            if ((readError as NodeJS.ErrnoException).code !== "ENOENT" && !(readError instanceof SyntaxError)) throw readError;
          }
          let ownerDead = false;
          if (Number.isInteger(lockOwner?.pid)) {
            try {
              process.kill(lockOwner!.pid!, 0);
            } catch (probeError) {
              ownerDead = (probeError as NodeJS.ErrnoException).code === "ESRCH";
            }
          }
          if (ownerDead) {
            const stalePath = `${lockPath}.stale.${randomUUID()}`;
            try {
              await rename(lockPath, stalePath);
              await rm(stalePath, { recursive: true, force: true });
              continue;
            } catch (reclaimError) {
              if ((reclaimError as NodeJS.ErrnoException).code !== "ENOENT") throw reclaimError;
            }
          }
          if (Date.now() >= deadline) throw new TeamArtifactError("ARTIFACT_PUBLICATION_LOCK_TIMEOUT", "Timed out waiting for the Artifact publication fence.");
          await delay(5);
        }
      }
      try {
        return await operation();
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    };
    const validatePublication = (value: unknown, expectedOwner?: TeamArtifactOwner, expectedPublicationId?: string): StoredPublicationReservation => {
      if (!isRecord(value) || !SAFE_ID.test(String(value.projectId ?? "")) || !SAFE_ID.test(String(value.runId ?? ""))
        || !SAFE_INVOCATION_ID.test(String(value.invocationId ?? "")) || !SAFE_ID.test(String(value.publicationId ?? ""))
        || !Number.isSafeInteger(value.fencingGeneration) || (value.fencingGeneration as number) < 1
        || !["reserved", "pending", "committed", "aborted"].includes(String(value.state)) || !isRecord(value.artifacts)) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing or corrupt.");
      }
      if ((expectedOwner && (value.projectId !== expectedOwner.projectId || value.runId !== expectedOwner.runId))
        || (expectedPublicationId && value.publicationId !== expectedPublicationId)) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation ownership is invalid.");
      }
      for (const [id, metadata] of Object.entries(value.artifacts)) {
        if (!isRecord(metadata) || metadata.artifactId !== id || metadata.kind !== "agent-output"
          || metadata.projectId !== value.projectId || metadata.runId !== value.runId
          || metadata.publicationId !== value.publicationId || metadata.invocationId !== value.invocationId
          || !Number.isSafeInteger(metadata.fencingGeneration) || (metadata.fencingGeneration as number) > (value.fencingGeneration as number)
          || !["prepared", "committed"].includes(String(metadata.publicationState))) {
          throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation contains invalid Artifact metadata.");
        }
        artifactId(id);
      }
      return value as unknown as StoredPublicationReservation;
    };
    const readPublication = async (owner: TeamArtifactOwner, publicationId: string): Promise<StoredPublicationReservation> => {
      try {
        return validatePublication(JSON.parse(await readFile(publicationPath(owner, publicationId), "utf8")), owner, publicationId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is missing.");
        if (error instanceof SyntaxError) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is corrupt.");
        throw error;
      }
    };
    const assertArtifactReservation = (reservation: StoredPublicationReservation, metadata: ArtifactMetadata, requireListed = true): void => {
      if (reservation.projectId !== metadata.projectId || reservation.runId !== metadata.runId
        || reservation.invocationId !== metadata.invocationId || reservation.publicationId !== metadata.publicationId
        || reservation.fencingGeneration !== metadata.fencingGeneration || (requireListed && !reservation.artifacts[metadata.artifactId])) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact operation has no matching durable reservation.");
      }
    };
    const cleanupPublication = async (reservation: StoredPublicationReservation): Promise<void> => {
      for (const [id, expected] of Object.entries(reservation.artifacts)) {
        const index = indexPath(id);
        try {
          const record = JSON.parse(await readFile(index, "utf8")) as { metadata?: ArtifactMetadata; contentPath?: string };
          if (!record.metadata || record.contentPath !== blobPath(expected)
            || record.metadata.artifactId !== id || record.metadata.projectId !== expected.projectId
            || record.metadata.runId !== expected.runId || record.metadata.publicationId !== expected.publicationId
            || record.metadata.fencingGeneration !== expected.fencingGeneration || record.metadata.publicationState !== "prepared") {
            throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact index does not match its durable reservation; cleanup refused.");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
          if (error instanceof SyntaxError) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact index is corrupt; cleanup refused.");
        }
        await rm(blobPath(expected), { force: true });
        await rm(index, { force: true });
      }
    };
    const hasCommittedArtifact = async (reservation: StoredPublicationReservation): Promise<boolean> => {
      for (const id of Object.keys(reservation.artifacts)) {
        try {
          const record = JSON.parse(await readFile(indexPath(id), "utf8")) as { metadata?: ArtifactMetadata; contentPath?: string };
          const expected = reservation.artifacts[id];
          if (!record.metadata || record.contentPath !== blobPath(expected) || record.metadata.artifactId !== id
            || record.metadata.projectId !== expected.projectId || record.metadata.runId !== expected.runId
            || record.metadata.publicationId !== expected.publicationId || record.metadata.fencingGeneration !== expected.fencingGeneration) {
            throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact index does not match its durable reservation.");
          }
          if (record.metadata.publicationState === "committed") return true;
          if (record.metadata.publicationState !== "prepared") throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication state is invalid.");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          if (error instanceof SyntaxError) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact index is corrupt.");
          throw error;
        }
      }
      return false;
    };
    const backend: TeamArtifactBlobBackend = {
      recoverPublications: async (owner, retainedPublicationIds, liveInvocationIds) => {
        assertOwner(owner);
        const directory = join(root, "projects", owner.projectId, "runs", owner.runId, "publications");
        let names: string[];
        try {
          names = await readdir(directory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (retainedPublicationIds.length) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "A retained Run publication has no Artifact reservation.");
          return [];
        }
        const publicationIds: string[] = [];
        for (const name of names) {
          if (!name.endsWith(".json")) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication directory contains an unexpected entry.");
          const id = name.slice(0, -5);
          if (!SAFE_ID.test(id)) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication directory contains an invalid ID.");
          publicationIds.push(id);
        }
        for (const retainedId of retainedPublicationIds) {
          if (!publicationIds.includes(retainedId)) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "A retained Run publication has no Artifact reservation.");
        }
        const recovered: TeamArtifactPublicationRecovery[] = [];
        for (const publicationId of publicationIds.sort()) {
          const item = await withPublicationLock(owner, publicationId, async () => {
            const reservation = await readPublication(owner, publicationId);
            const hasCommitted = await hasCommittedArtifact(reservation);
            if (reservation.state === "aborted" && hasCommitted) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Aborted reservation references a committed Artifact.");
            if (retainedPublicationIds.includes(publicationId) && reservation.state === "aborted") {
              throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "A retained Run publication is already aborted.");
            }
            if (reservation.state !== "committed" && !retainedPublicationIds.includes(publicationId)
              && !liveInvocationIds.includes(reservation.invocationId) && !hasCommitted) {
              if (reservation.state !== "aborted") {
                reservation.state = "aborted";
                reservation.fencingGeneration += 1;
                await writeAtomic(publicationPath(owner, publicationId), JSON.stringify(reservation));
              }
              await cleanupPublication(reservation);
            } else if (reservation.state === "aborted") {
              await cleanupPublication(reservation);
            }
            return {
              reservation: {
                projectId: reservation.projectId,
                runId: reservation.runId,
                invocationId: reservation.invocationId,
                publicationId: reservation.publicationId,
                fencingGeneration: reservation.fencingGeneration
              },
              state: reservation.state,
              artifactIds: Object.keys(reservation.artifacts)
            };
          });
          recovered.push(item);
        }
        return recovered;
      },
      reservePublication: async (owner, invocationId, publicationId) => withPublicationLock(owner, publicationId, async () => {
        assertInvocationId(invocationId);
        const path = publicationPath(owner, publicationId);
        let existing: StoredPublicationReservation | undefined;
        try {
          existing = validatePublication(JSON.parse(await readFile(path, "utf8")), owner, publicationId);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            if (error instanceof SyntaxError) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication reservation is corrupt.");
            throw error;
          }
        }
        if (existing) {
          if (existing.invocationId !== invocationId || existing.state !== "reserved") {
            throw new TeamArtifactError("ARTIFACT_RESERVATION_CONFLICT", "Artifact publication ID is already reserved or terminal.");
          }
          return { projectId: existing.projectId, runId: existing.runId, invocationId: existing.invocationId, publicationId: existing.publicationId, fencingGeneration: existing.fencingGeneration };
        }
        const reservation: StoredPublicationReservation = { ...owner, invocationId, publicationId, fencingGeneration: 1, state: "reserved", artifacts: {} };
        await writeAtomic(path, JSON.stringify(reservation));
        return { projectId: owner.projectId, runId: owner.runId, invocationId, publicationId, fencingGeneration: reservation.fencingGeneration };
      }),
      activatePublication: async (token, artifactIds) => withPublicationLock(token, token.publicationId, async () => {
        const reservation = await readPublication(token, token.publicationId);
        assertReservationToken(token, reservation);
        if (reservation.state === "pending") {
          if (!sameArtifactSet(Object.keys(reservation.artifacts), artifactIds)) throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication references do not match the reservation.");
          return;
        }
        if (reservation.state !== "reserved" || !sameArtifactSet(Object.keys(reservation.artifacts), artifactIds)) {
          throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication cannot be activated with these references.");
        }
        reservation.state = "pending";
        await writeAtomic(publicationPath(token, token.publicationId), JSON.stringify(reservation));
      }),
      finishPublication: async (token) => withPublicationLock(token, token.publicationId, async () => {
        const reservation = await readPublication(token, token.publicationId);
        assertReservationToken(token, reservation);
        if (reservation.state === "committed") return;
        if (reservation.state !== "pending") throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication is not pending.");
        for (const id of Object.keys(reservation.artifacts)) {
          const stored = await backend.get(id);
          if (!stored || stored.metadata.publicationState !== "committed") throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Artifact publication is not fully committed.");
        }
        reservation.state = "committed";
        await writeAtomic(publicationPath(token, token.publicationId), JSON.stringify(reservation));
      }),
      abortPublication: async (token) => withPublicationLock(token, token.publicationId, async () => {
        const reservation = await readPublication(token, token.publicationId);
        assertReservationToken(token, reservation);
        if (reservation.state === "committed" || await hasCommittedArtifact(reservation)) {
          throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Committed Artifact publications cannot be aborted.");
        }
        if (reservation.state !== "aborted") {
          reservation.state = "aborted";
          reservation.fencingGeneration += 1;
          await writeAtomic(publicationPath(token, token.publicationId), JSON.stringify(reservation));
        }
        await cleanupPublication(reservation);
      }),
      put: async (id, content, metadata) => {
        const write = async (): Promise<void> => {
        artifactId(id);
        assertProjectId(metadata.projectId);
        if (metadata.kind === "agent-output") assertOwner({ projectId: metadata.projectId, runId: metadata.runId ?? "" });
        if (metadata.kind === "agent-output") {
          const reservation = await readPublication({ projectId: metadata.projectId, runId: metadata.runId! }, metadata.publicationId!);
          assertArtifactReservation(reservation, metadata, false);
          if (reservation.state !== "reserved") throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact publication no longer accepts prepared output.");
          if (!reservation.artifacts[id]) {
            reservation.artifacts[id] = structuredClone(metadata);
            await writeAtomic(publicationPath({ projectId: metadata.projectId, runId: metadata.runId! }, metadata.publicationId!), JSON.stringify(reservation));
          } else if (JSON.stringify(reservation.artifacts[id]) !== JSON.stringify(metadata)) {
            throw new TeamArtifactError("ARTIFACT_ID_CONFLICT", "Artifact ID is already reserved with different metadata.");
          }
        }
        const path = blobPath(metadata);
        await mkdir(resolve(path, ".."), { recursive: true });
        try {
          await writeFile(path, content, { flag: "wx" });
          await writeAtomic(indexPath(id), JSON.stringify({ metadata, contentPath: path }));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new TeamArtifactError("ARTIFACT_ID_CONFLICT", "Artifact ID already exists.");
          throw error;
        }
        };
        if (metadata.kind === "run-input") return write();
        return withPublicationLock({ projectId: metadata.projectId, runId: metadata.runId ?? "" }, metadata.publicationId ?? "", write);
      },
      commitOutput: async (id, publicationId, fencingGeneration) => {
        const artifact = await backend.get(id);
        if (!artifact) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication intent does not match.");
        await withPublicationLock({ projectId: artifact.metadata.projectId, runId: artifact.metadata.runId ?? "" }, publicationId, async () => {
        const reservation = await readPublication({ projectId: artifact.metadata.projectId, runId: artifact.metadata.runId! }, publicationId);
        assertArtifactReservation(reservation, artifact.metadata);
        if (fencingGeneration !== undefined && reservation.fencingGeneration !== fencingGeneration) throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact commit fencing token is stale.");
        if (reservation.state !== "pending") throw new TeamArtifactError("ARTIFACT_RESERVATION_STALE", "Artifact publication is not commit eligible.");
        const stored = await backend.get(id);
        if (!stored || stored.metadata.publicationId !== publicationId) throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Artifact publication intent does not match.");
        if (stored.metadata.publicationState === "committed") return;
        const path = indexPath(id);
        await writeAtomic(path, JSON.stringify({ metadata: { ...stored.metadata, publicationState: "committed" }, contentPath: blobPath(stored.metadata) }));
        });
      },
      abortOutput: async (id, expected) => withPublicationLock({ projectId: expected.projectId, runId: expected.runId ?? "" }, expected.publicationId ?? "", async () => {
        const owner = { projectId: expected.projectId, runId: expected.runId! };
        const reservation = await readPublication(owner, expected.publicationId!);
        assertArtifactReservation(reservation, expected);
        if (reservation.state === "committed" || await hasCommittedArtifact(reservation)) {
          throw new TeamArtifactError("ARTIFACT_PUBLICATION_INVALID", "Committed Artifact publications cannot be aborted.");
        }
        if (reservation.state !== "aborted") {
          reservation.state = "aborted";
          reservation.fencingGeneration += 1;
          await writeAtomic(publicationPath(owner, expected.publicationId!), JSON.stringify(reservation));
        }
        await cleanupPublication(reservation);
      }),
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
