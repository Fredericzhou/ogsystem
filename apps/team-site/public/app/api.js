import { isCurrentRequest, state } from "./state.js";

export function requestAbortError() {
  return Object.assign(new Error("Request aborted"), { name: "AbortError" });
}

export function pageFetch(input, options = {}) {
  const request = state.activeRequest;
  if (request && !isCurrentRequest(request)) return Promise.reject(requestAbortError());
  const { signal: operationSignal, ...init } = options;
  const requestSignal = request?.signal;
  let signal = requestSignal || operationSignal;
  if (requestSignal && operationSignal && requestSignal !== operationSignal) {
    if (typeof AbortSignal.any === "function") signal = AbortSignal.any([requestSignal, operationSignal]);
    else {
      const combined = new AbortController();
      const abort = () => combined.abort();
      requestSignal.addEventListener("abort", abort, { once: true });
      operationSignal.addEventListener("abort", abort, { once: true });
      signal = combined.signal;
    }
  }
  const pending = window.fetch(input, signal ? { ...init, signal } : init);
  return pending.then((response) => {
    if (request && !isCurrentRequest(request)) throw requestAbortError();
    if (!request) return response;
    return new Proxy(response, {
      get(target, property, receiver) {
        if (property === "json") {
          return async (...args) => {
            const payload = await target.json(...args);
            if (!isCurrentRequest(request)) throw requestAbortError();
            return payload;
          };
        }
        return Reflect.get(target, property, target);
      }
    });
  });
}
