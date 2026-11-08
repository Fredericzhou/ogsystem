/**
 * Runtime-only error-flow events are reserved for failure routing and must not
 * be treated as normal selectable role output events.
 */
import { isRuntimeErrorEvent } from "./business-events.js";

export { isRuntimeErrorEvent } from "./business-events.js";

export function isRuntimeOnlyErrorEvent(eventType: string): boolean {
  return isRuntimeErrorEvent(eventType);
}
