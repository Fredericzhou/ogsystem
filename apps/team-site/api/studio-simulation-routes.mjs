export async function handleStudioSimulationRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  const previewCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
  const contentTypeForPath = (pathValue, mediaType) => {
    if (mediaType && mediaType !== "application/octet-stream") {
      return mediaType.includes("charset=") || (!mediaType.startsWith("text/") && !/^(application\/(json|xml|javascript|graphql))$/i.test(mediaType))
        ? mediaType
        : `${mediaType}; charset=utf-8`;
    }
    const lower = String(pathValue || "").toLowerCase();
    if (lower.endsWith(".html")) return "text/html; charset=utf-8";
    if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
    if (lower.endsWith(".json") || lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) return "application/json; charset=utf-8";
    if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".mmd")) return "text/plain; charset=utf-8";
    return "application/octet-stream";
  };
  const sanitizePreview = (content, contentType, allowInlineScript = false) => {
    if (!contentType.startsWith("text/html") && !contentType.startsWith("image/svg+xml")) return content;
    let sanitized = String(content)
      .replace(allowInlineScript
        ? /<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module["'])[^>]*>[\s\S]*?<\/script>|<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module["'])[^>]*\/?\s*>/gi
        : /<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/?\s*>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(?:href|src|xlink:href)\s*=\s*(?:"(?:https?:|\/\/|javascript:)[^\"]*"|'(?:https?:|\/\/|javascript:)[^']*'|(?:https?:|\/\/|javascript:)[^\s>]+)/gi, "")
      .replace(/<base\b[^>]*>|<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>|<(?:object|embed|iframe)\b[^>]*>[\s\S]*?<\/(?:object|embed|iframe)>/gi, "");
    if (contentType.startsWith("image/svg+xml")) sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<script\b[^>]*\/?\s*>/gi, "");
    return sanitized;
  };
  const isRange = Boolean(request.headers?.range);
  const sendRangeError = (error) => {
    if (error?.code !== "BYTE_RANGE_NOT_SATISFIABLE") return false;
    response.writeHead(416, { "content-range": `bytes */${error.size}`, "cache-control": "no-store" });
    response.end();
    return true;
  };
  const pipeArtifact = (artifact, contentType, filename, isDownload) => {
    const ranged = Boolean(artifact.range);
    response.writeHead(ranged ? 206 : 200, {
      "content-type": contentType,
      "content-length": String(artifact.contentLength ?? artifact.size),
      "accept-ranges": "bytes",
      ...(ranged ? { "content-range": `bytes ${artifact.range.start}-${artifact.range.end}/${artifact.size}` } : {}),
      "cache-control": "no-store",
      "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename.replaceAll('"', "")}"`,
      "x-content-type-options": "nosniff",
      ...(isDownload || (!contentType.startsWith("text/html") && !contentType.startsWith("image/svg+xml")) ? {} : { "content-security-policy": previewCsp })
    });
    artifact.stream.pipe(response);
  };
  const workspaceOpen = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/workspace\/open-directory$/);
  if (workspaceOpen && request.method === "POST") {
    const remoteAddress = String(request.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    const localRequest = remoteAddress === "::1" || remoteAddress === "127.0.0.1" || remoteAddress === "localhost";
    if (!localRequest) {
      sendJson(response, 403, { error: "LOCAL_WORKSPACE_OPEN_ONLY" });
      return true;
    }
    try {
      sendJson(response, 200, await useCases.openTeamVersionWorkspaceDirectory(workspaceOpen[1], workspaceOpen[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to open Team workspace." });
    }
    return true;
  }

  const collection = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations$/);
  if (collection && request.method === "POST") {
    try {
      sendJson(response, 202, await useCases.createSimulation(collection[1], collection[2], { ...(await readBody(request)), awaitCompletion: false }));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to create Studio Simulation." });
    }
    return true;
  }
  if (collection && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.listTeamVersionSimulations(collection[1], collection[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list Studio Simulations." });
    }
    return true;
  }
  if (collection && request.method === "DELETE") {
    try {
      sendJson(response, 200, await useCases.clearInteractiveSimulations(collection[1], collection[2]));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to clear Studio Simulation history." });
    }
    return true;
  }

  const artifactPathMatch = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)\/artifacts(?:\/(.*))?$/);
  if (artifactPathMatch && request.method === "GET") {
    try {
      const teamId = artifactPathMatch[1];
      const teamVersionId = artifactPathMatch[2];
      const simulationId = artifactPathMatch[3];
      const artifactPath = artifactPathMatch[4] ? decodeURIComponent(artifactPathMatch[4]) : "";
      if (artifactPath === "seal-manifest") {
        sendJson(response, 200, await useCases.readTeamVersionSimulationSealManifest(teamId, teamVersionId, simulationId));
        return true;
      }
      if (artifactPath === "verification") {
        sendJson(response, 200, await useCases.readTeamVersionSimulationVerificationReport(teamId, teamVersionId, simulationId));
        return true;
      }
      if (artifactPath.startsWith("sealed/")) {
        const sealedPath = artifactPath.slice("sealed/".length);
        const isDownload = url.searchParams.get("download") === "1";
        const requestedType = contentTypeForPath(sealedPath);
        const textPreviewCandidate = requestedType.startsWith("text/") || requestedType.startsWith("application/json") || requestedType.startsWith("image/svg+xml");
        let sealed;
        const openOptions = {
          range: request.headers?.range,
          maxBytes: isDownload || !textPreviewCandidate ? 256 * 1024 * 1024 : 2 * 1024 * 1024,
          maxRangeBytes: 32 * 1024 * 1024
        };
        if ((isDownload || isRange || !textPreviewCandidate) && typeof useCases.openTeamVersionSimulationSealedFile === "function") {
          sealed = await useCases.openTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, sealedPath, openOptions);
        } else {
          sealed = await useCases.readTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, sealedPath, { maxBytes: openOptions.maxBytes, encoding: null });
          if (sealed.tooLarge && typeof useCases.openTeamVersionSimulationSealedFile === "function") {
            sealed = await useCases.openTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, sealedPath, openOptions);
          }
        }
        if (sealed.tooLarge) {
          sendJson(response, 413, { error: "STUDIO_SIMULATION_ARTIFACT_TOO_LARGE", path: sealed.path, size: sealed.size });
          return true;
        }
        const contentType = contentTypeForPath(sealed.path, sealed.mediaType);
        const preview = !isDownload && (contentType.startsWith("text/html") || contentType.startsWith("image/svg+xml"));
        const allowInlineScript = preview && contentType.startsWith("text/html") && url.searchParams.get("interactive") === "1";
        if (sealed.stream && preview) {
          sealed.stream.destroy();
          sealed = await useCases.readTeamVersionSimulationSealedFile(teamId, teamVersionId, simulationId, sealedPath, { maxBytes: 2 * 1024 * 1024, encoding: null });
          if (sealed.tooLarge) {
            sendJson(response, 413, { error: "STUDIO_SIMULATION_ARTIFACT_TOO_LARGE", path: sealed.path, size: sealed.size });
            return true;
          }
        }
        if (sealed.stream) {
          pipeArtifact(sealed, contentType, sealed.path.split("/").at(-1) || "artifact", isDownload);
          return true;
        }
        const body = Buffer.isBuffer(sealed.content) ? (preview ? Buffer.from(sanitizePreview(sealed.content.toString("utf8"), contentType, allowInlineScript), "utf8") : sealed.content) : sealed.content;
        response.writeHead(200, {
          "content-type": contentType,
          "cache-control": "no-store",
          "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${sealed.path.split("/").at(-1)?.replaceAll('"', "") || "artifact"}"`,
          "x-content-type-options": "nosniff",
          ...(preview ? { "content-security-policy": previewCsp } : {})
        });
        response.end(body || "");
        return true;
      }
      if (!artifactPath) {
        sendJson(response, 200, await useCases.listTeamVersionSimulationArtifacts(teamId, teamVersionId, simulationId));
        return true;
      }
      const isDownload = url.searchParams.get("download") === "1";
      const artifact = await useCases.readTeamVersionSimulationArtifact(teamId, teamVersionId, simulationId, artifactPath, { maxBytes: isDownload ? 32 * 1024 * 1024 : 1024 * 1024 });
      if (artifact.tooLarge) {
        sendJson(response, 413, {
          error: "STUDIO_SIMULATION_ARTIFACT_TOO_LARGE",
          path: artifact.path,
          size: artifact.size,
          ...(isDownload ? {} : { downloadUrl: `${url.pathname}?download=1` })
        });
        return true;
      }
      const contentType = artifactPath.endsWith(".json") || artifactPath.endsWith(".ndjson") || artifactPath.endsWith(".jsonl")
        ? "application/json; charset=utf-8"
        : artifactPath.endsWith(".mmd") || artifactPath.endsWith(".md") || artifactPath.endsWith(".log")
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";
      const filename = artifactPath.split("/").at(-1) || "artifact";
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename.replaceAll('"', "")}"`,
        "x-content-type-options": "nosniff"
      });
      response.end(artifact.content || "");
    } catch (error) {
      if (sendRangeError(error)) return true;
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Simulation artifacts." });
    }
    return true;
  }

  const stop = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)\/stop$/);
  if (stop && request.method === "POST") {
    try {
      const body = await readBody(request, 32 * 1024);
      sendJson(response, 202, await useCases.stopSimulation(stop[1], stop[2], stop[3], body.reason));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to stop Studio Simulation." });
    }
    return true;
  }

  const detail = url.pathname.match(/^\/api\/v1\/teams\/([a-z0-9-]+)\/versions\/([a-z0-9-]+)\/simulations\/([a-z0-9-]+)(?:\/(events))?$/);
  if (detail && request.method === "GET") {
    try {
      if (detail[4]) {
        sendJson(response, 200, await useCases.getTeamVersionSimulationEvents(detail[1], detail[2], detail[3], url.searchParams.get("afterCursor") || 0));
      } else {
        sendJson(response, 200, await useCases.getTeamVersionSimulation(detail[1], detail[2], detail[3]));
      }
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Studio Simulation." });
    }
    return true;
  }
  return false;
}
