export async function handleTaskRunOutputRoutes({ request, response, url, sendJson, errorStatus, useCases }) {
  const collection = url.pathname.match(/^\/api\/v2\/projects\/([a-z0-9-]+)\/collaboration-outputs$/);
  if (collection && request.method === "GET") {
    try { sendJson(response, 200, await useCases.listProjectCollaborationOutputs(collection[1])); }
    catch (error) { sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list collaboration outputs." }); }
    return true;
  }

  const match = url.pathname.match(/^\/api\/v2\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)\/outputs(?:\/(files(?:\/(.*))?))?$/);
  if (!match) return false;
  const [, projectId, taskId, runId, fileAction, encodedPath] = match;
  try {
    if (!fileAction && request.method === "GET") {
      sendJson(response, 200, await useCases.getProjectRunOutput(projectId, taskId, runId));
    } else if (fileAction === "files" && request.method === "GET") {
      sendJson(response, 200, await useCases.listProjectRunOutputFiles(projectId, taskId, runId));
    } else if (fileAction?.startsWith("files/") && request.method === "GET") {
      const filePath = decodeURIComponent(encodedPath || "");
      const isDownload = url.searchParams.get("download") === "1";
      const result = await useCases.readProjectRunOutputFile(projectId, taskId, runId, filePath, {
        maxBytes: isDownload ? 256 * 1024 * 1024 : 2 * 1024 * 1024,
        encoding: null
      });
      if (result.tooLarge) {
        sendJson(response, 413, { error: "COLLABORATION_OUTPUT_FILE_TOO_LARGE", path: result.path, size: result.size });
        return true;
      }
      const content = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content || "");
      const filename = (filePath.split("/").at(-1) || "file").replace(/[\"\r\n]/g, "") || "file";
      response.writeHead(200, {
        "content-type": result.mediaType || "application/octet-stream",
        "content-length": String(content.length),
        "content-disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(content);
    } else {
      return false;
    }
  } catch (error) {
    sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read collaboration output." });
  }
  return true;
}
