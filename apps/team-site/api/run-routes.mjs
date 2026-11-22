export async function handleRunRoutes({ request, response, url, readBody, sendJson, errorStatus, useCases }) {
  if (request.method === "GET" && url.pathname === "/api/v2/projects/runs/recent") {
    try {
      sendJson(response, 200, { runs: await useCases.listRecentProjectRuns(Number(url.searchParams.get("limit") || 50)) });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to list recent Runs." });
    }
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/v2\/projects\/([a-z0-9-]+)\/tasks\/([A-Za-z0-9._-]+)\/runs\/([A-Za-z0-9._-]+)(?:\/(events|manifest|result|cleanup))?$/);
  if (!runMatch) return false;
  const [, projectId, taskId, runId, action] = runMatch;
  if (action === "cleanup" && request.method === "POST") {
    try {
      const result = await useCases.cleanupProjectRunWorkspace(projectId, taskId, runId, await readBody(request));
      sendJson(response, 200, {
        projectId: result.projectId,
        taskId: result.taskId,
        runId: result.runId,
        workspaceId: result.workspaceId,
        removedWorktreeCount: result.removedWorktrees.length,
        removedBranchCount: result.removedBranches.length
      });
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to clean up the Project Run Workspace." });
    }
    return true;
  }
  if (action === "result" && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectRunResult(projectId, taskId, runId));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project run result." });
    }
    return true;
  }
  if (action === "events" && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectRunEvents(projectId, taskId, runId, {
        cursor: url.searchParams.has("cursor") ? Number(url.searchParams.get("cursor")) : undefined,
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        type: url.searchParams.get("type") || undefined,
        roleId: url.searchParams.get("roleId") || undefined,
        branchId: url.searchParams.get("branchId") || undefined,
        status: url.searchParams.get("status") || undefined,
        errorCode: url.searchParams.get("errorCode") || undefined,
        channel: url.searchParams.get("channel") || undefined
      }));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project run events." });
    }
    return true;
  }
  if (action === "manifest" && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectRunEvidenceManifest(projectId, taskId, runId));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read Run Evidence manifest." });
    }
    return true;
  }
  if (!action && request.method === "GET") {
    try {
      sendJson(response, 200, await useCases.getProjectRun(projectId, taskId, runId));
    } catch (error) {
      sendJson(response, errorStatus(error), { error: error instanceof Error ? error.message : "Unable to read project run." });
    }
    return true;
  }
  return false;
}
