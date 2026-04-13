/**
 * Runtime-only error-edge events are reserved for failure routing and must not
 * be treated as normal selectable role output events.
 */
export function isRuntimeOnlyErrorEvent(eventType: string): boolean {
  return eventType === "ERROR" || eventType.startsWith("ERROR.");
}
