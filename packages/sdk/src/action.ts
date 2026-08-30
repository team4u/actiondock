import type { ActionDefinition } from "./types";

/**
 * Helper to define a type-safe Action definition.
 */
export function defineAction<I = unknown, O = unknown>(
  definition: ActionDefinition<I, O>
): ActionDefinition<I, O> {
  if (!definition || typeof definition !== "object") {
    throw new Error("Action definition must be an object");
  }
  if (!definition.id || typeof definition.id !== "string") {
    throw new Error("Action definition must have a string 'id'");
  }
  if (typeof definition.run !== "function") {
    throw new Error(`Action '${definition.id}' must have a 'run' function`);
  }
  return definition;
}
