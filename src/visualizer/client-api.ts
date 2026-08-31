/** Browser API transport helpers. Keeps timeout, abort, and error-envelope behavior uniform. */
export function createClientApi(translate: (key: string, vars?: Record<string, unknown>, fallback?: string) => string) {
  function readApiError(payload: any, fallback: string): string {
    return payload?.error?.message || fallback;
  }

  function createApiError(payload: any, fallback: string): Error & Record<string, any> {
    const error = new Error(readApiError(payload, fallback)) as Error & Record<string, any>;
    if (payload?.error) {
      error.code = payload.error.code || "";
      error.details = payload.error.details;
      error.payload = payload;
    }
    return error;
  }

  function createClientTimeoutError(path: string, timeoutMs: number): Error & Record<string, any> {
    const error = new Error(translate("api.requestTimeout", {
      seconds: String(Math.ceil(timeoutMs / 1000))
    }, "Request timed out after {seconds}s. Check the server connection and retry.")) as Error & Record<string, any>;
    error.code = "CLIENT_REQUEST_TIMEOUT";
    error.path = path;
    return error;
  }

  function isAbortError(error: any): boolean {
    return Boolean(error && (error.name === "AbortError" || error.code === "CLIENT_REQUEST_ABORTED"));
  }

  async function requestJson(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<any> {
    const requestOptions = options || {};
    const timeoutMs = Number(requestOptions.timeoutMs || 0);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let controller: AbortController | null = null;
    let signal = requestOptions.signal;
    if (timeoutMs > 0) {
      controller = new AbortController();
      signal = controller.signal;
      if (requestOptions.signal) {
        if (requestOptions.signal.aborted) controller.abort(requestOptions.signal.reason);
        else requestOptions.signal.addEventListener("abort", () => controller?.abort(requestOptions.signal?.reason), { once: true });
      }
    }
    let response: Response;
    try {
      const { timeoutMs: _timeoutMs, signal: _optionSignal, ...fetchOptions } = requestOptions;
      const fetchPromise = fetch(path, {
        ...fetchOptions,
        headers: { accept: "application/json", ...(fetchOptions.headers || {}) },
        signal,
        cache: fetchOptions.cache || "no-store"
      });
      response = timeoutMs > 0
        ? await Promise.race([
            fetchPromise,
            new Promise<Response>((_, reject) => {
              timeoutId = setTimeout(() => {
                timedOut = true;
                controller?.abort(createClientTimeoutError(path, timeoutMs));
                reject(createClientTimeoutError(path, timeoutMs));
              }, timeoutMs);
            })
          ])
        : await fetchPromise;
    } catch (error) {
      if (timedOut) throw createClientTimeoutError(path, timeoutMs);
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    if (signal?.aborted) {
      if (timedOut) throw createClientTimeoutError(path, timeoutMs);
      if (signal.reason instanceof Error) throw signal.reason;
      const error = new Error(translate("studio.chat.cancelled", undefined, "Studio chat request cancelled.")) as Error & Record<string, any>;
      error.code = "CLIENT_REQUEST_ABORTED";
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
    if (!response.ok) throw createApiError(payload, `${response.status} ${response.statusText}`);
    return payload;
  }

  function requestAction(path: string, body?: unknown, options?: RequestInit & { timeoutMs?: number }) {
    return requestJson(path, {
      ...(options || {}),
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...(options?.headers || {}) },
      body: JSON.stringify(body || {})
    });
  }

  return { requestJson, requestAction, isAbortError };
}
