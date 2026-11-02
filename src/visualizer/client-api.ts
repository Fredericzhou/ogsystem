export type ElectronApiBridge = {
  invoke: (channel: string, payload?: unknown) => Promise<any>;
  send?: (channel: string, payload?: unknown) => void;
  on?: (channel: string, listener: (...args: any[]) => void) => () => void;
};

declare global {
  interface Window {
    OGSElectronAPI?: ElectronApiBridge;
  }
}

export interface IVisualizerTransportAdapter {
  requestJson(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<any>;
  requestAction(path: string, body?: unknown, options?: RequestInit & { timeoutMs?: number }): Promise<any>;
  isAbortError(error: any): boolean;
}

/** Browser and Electron desktop API transport helpers. Keeps timeout, abort, and error-envelope behavior uniform. */
export function createClientApi(
  translate: (key: string, vars?: Record<string, unknown>, fallback?: string) => string,
  projectId?: () => string
): IVisualizerTransportAdapter {
  let nextElectronRequestId = 0;
  function scopedPath(path: string): string {
    const id = String(projectId?.() || "").trim();
    if (!id || !path.startsWith("/api/")) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("projectId", id);
    return url.pathname + url.search;
  }
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

  function createClientAbortError(): Error & Record<string, any> {
    const error = new Error(translate("studio.chat.cancelled", undefined, "Studio chat request cancelled.")) as Error & Record<string, any>;
    error.code = "CLIENT_REQUEST_ABORTED";
    return error;
  }

  async function requestElectron(
    requestPath: string,
    requestOptions: RequestInit & { timeoutMs?: number }
  ): Promise<{ handled: boolean; payload?: any }> {
    const invoke = typeof window !== "undefined" ? window.OGSElectronAPI?.invoke : undefined;
    if (typeof invoke !== "function") return { handled: false };

    const timeoutMs = Number(requestOptions.timeoutMs || 0);
    const signal = requestOptions.signal;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : createClientAbortError();

    // RequestInit contains AbortSignal and other browser-only objects that cannot
    // cross Electron's structured-clone boundary. Keep the IPC contract plain.
    const ipcOptions = {
      method: requestOptions.method,
      headers: requestOptions.headers ? Object.fromEntries(new Headers(requestOptions.headers).entries()) : undefined,
      body: typeof requestOptions.body === "string" ? requestOptions.body : undefined,
      cache: requestOptions.cache,
      credentials: requestOptions.credentials
    };
    const requestId = `visualizer-request-${++nextElectronRequestId}`;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortListener: (() => void) | null = null;
    let settled = false;
    const invokePromise = Promise.resolve().then(() => invoke("visualizer:request", {
      requestId,
      path: requestPath,
      options: ipcOptions
    }));
    const controlled = new Promise<any>((resolve, reject) => {
      const finish = (callback: (value?: any) => void, value?: any) => {
        if (settled) return;
        settled = true;
        if (callback === reject) {
          try {
            window.OGSElectronAPI?.send?.("visualizer:cancel-request", { requestId });
          } catch {
            // Cancellation is best-effort when the host does not expose send().
          }
        }
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
        callback(value);
      };
      invokePromise.then(
        (payload) => finish(resolve, payload),
        (error) => finish(reject, error)
      );
      if (signal) {
        abortListener = () => finish(reject, signal.reason instanceof Error ? signal.reason : createClientAbortError());
        signal.addEventListener("abort", abortListener, { once: true });
      }
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => finish(reject, createClientTimeoutError(requestPath, timeoutMs)), timeoutMs);
      }
    });

    try {
      const ipcPayload = await controlled;
      if (ipcPayload === undefined) return { handled: false };
      if (ipcPayload?.error) {
        throw createApiError(ipcPayload, readApiError(ipcPayload, "Electron IPC request failed"));
      }
      return { handled: true, payload: ipcPayload };
    } catch (error: any) {
      if (error?.code === "IPC_CHANNEL_UNHANDLED") return { handled: false };
      throw error;
    }
  }

  async function requestJson(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<any> {
    const requestOptions = options || {};
    const timeoutMs = Number(requestOptions.timeoutMs || 0);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let controller: AbortController | null = null;
    let signal = requestOptions.signal;
    const requestPath = scopedPath(path);

    const electronResult = await requestElectron(requestPath, requestOptions);
    if (electronResult.handled) return electronResult.payload;
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
      const fetchPromise = fetch(requestPath, {
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
                controller?.abort(createClientTimeoutError(requestPath, timeoutMs));
                reject(createClientTimeoutError(requestPath, timeoutMs));
              }, timeoutMs);
            })
          ])
        : await fetchPromise;
    } catch (error) {
      if (timedOut) throw createClientTimeoutError(requestPath, timeoutMs);
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    if (signal?.aborted) {
      if (timedOut) throw createClientTimeoutError(requestPath, timeoutMs);
      if (signal.reason instanceof Error) throw signal.reason;
      throw createClientAbortError();
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
