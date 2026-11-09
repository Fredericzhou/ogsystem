export async function handleDeliverableRoutes({ request, response, url, sendJson, errorStatus, useCases }) {
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
  const collection = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables$/);
  if (collection && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listProjectDeliverables(collection[1])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list deliverables." }); }
    return true;
  }
  const archive = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)\/deliverable$/);
  if (archive && request.method === "POST") {
    try {
      const result = await useCases.archiveProjectRun(archive[1], archive[2], archive[3]);
      sendJson(response, result.deliverable?.idempotentReplay ? 200 : 201, result);
    }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to archive deliverable." }); }
    return true;
  }
  const content = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables\/([A-Za-z0-9._-]+)\/content$/);
  if (content && request.method === "GET") {
    try { sendJson(response, 200, await useCases.getProjectDeliverableContent(content[1], content[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read deliverable." }); }
    return true;
  }
  const files = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables\/([A-Za-z0-9._-]+)\/files$/);
  if (files && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listProjectDeliverableFiles(files[1], files[2])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list deliverable files." }); }
    return true;
  }
  const file = url.pathname.match(/^\/api\/v1\/projects\/([a-z0-9-]+)\/deliverables\/([A-Za-z0-9._-]+)\/files\/(.*)$/);
  if (file && request.method === "GET") {
    try {
      const filePath = decodeURIComponent(file[3]);
      const isDownload = url.searchParams.get("download") === "1";
      const requestedType = contentTypeForPath(filePath);
      const textPreviewCandidate = requestedType.startsWith("text/") || requestedType.startsWith("application/json") || requestedType.startsWith("image/svg+xml");
      let artifact;
      const openOptions = {
        range: request.headers?.range,
        maxBytes: isDownload || !textPreviewCandidate ? 256 * 1024 * 1024 : 2 * 1024 * 1024,
        maxRangeBytes: 32 * 1024 * 1024
      };
      if ((isDownload || isRange || !textPreviewCandidate) && typeof useCases.openProjectDeliverableFile === "function") {
        artifact = await useCases.openProjectDeliverableFile(file[1], file[2], filePath, openOptions);
      } else {
        artifact = await useCases.readProjectDeliverableFile(file[1], file[2], filePath, { maxBytes: openOptions.maxBytes, encoding: null });
        if (artifact.tooLarge && typeof useCases.openProjectDeliverableFile === "function") {
          artifact = await useCases.openProjectDeliverableFile(file[1], file[2], filePath, openOptions);
        }
      }
      if (artifact.tooLarge) { sendJson(response, 413, { error: "DELIVERABLE_FILE_TOO_LARGE", path: artifact.path, size: artifact.size }); return true; }
      const contentType = contentTypeForPath(filePath, artifact.mediaType);
      const preview = !isDownload && (contentType.startsWith("text/html") || contentType.startsWith("image/svg+xml"));
      const allowInlineScript = preview && contentType.startsWith("text/html") && url.searchParams.get("interactive") === "1";
      if (artifact.stream && preview) {
        artifact.stream.destroy();
        artifact = await useCases.readProjectDeliverableFile(file[1], file[2], filePath, { maxBytes: 2 * 1024 * 1024, encoding: null });
      }
      if (artifact.stream) {
        pipeArtifact(artifact, contentType, filePath.split("/").at(-1) || "file", isDownload);
        return true;
      }
      const body = Buffer.isBuffer(artifact.content) ? (preview
        ? Buffer.from(sanitizePreview(artifact.content.toString("utf8"), contentType, allowInlineScript), "utf8")
        : artifact.content) : artifact.content;
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${filePath.split("/").at(-1)?.replaceAll('"', "") || "file"}"`,
        "x-content-type-options": "nosniff",
        ...(preview ? { "content-security-policy": previewCsp } : {})
      });
      response.end(body || "");
    } catch (error) {
      if (sendRangeError(error)) return true;
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read deliverable file." });
    }
    return true;
  }
  return false;
}
