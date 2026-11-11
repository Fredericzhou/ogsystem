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
        if (typeof property === "string" && ["arrayBuffer", "blob", "formData", "json", "text"].includes(property)) {
          return async (...args) => {
            const payload = await target[property](...args);
            if (!isCurrentRequest(request)) throw requestAbortError();
            return payload;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  });
}
