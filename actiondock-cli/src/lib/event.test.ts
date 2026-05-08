import { describe, expect, it } from "vitest";

import { applyProcessorFieldOverrides, mergeDefinitionPatch } from "./event.js";
import type { EventSourceDefinition, EventTrigger } from "./types.js";

describe("applyProcessorFieldOverrides", () => {
  it("clears event trigger processor fields when patch uses empty objects", () => {
    const existing: Pick<EventTrigger, "filterProcessor" | "idempotencyProcessor" | "inputProcessor"> = {
      filterProcessor: {
        mode: "JSON_PATH",
        jsonPath: { fields: { matched: "$.eventType" } }
      },
      idempotencyProcessor: {
        mode: "JSON_PATH",
        jsonPath: { fields: { key: "$.eventId" } }
      },
      inputProcessor: {
        mode: "SCRIPT_REF",
        scriptRef: { scriptId: "processor-1", versionMode: "PUBLISHED" }
      }
    };
    const patch: Partial<Pick<EventTrigger, "filterProcessor" | "idempotencyProcessor" | "inputProcessor">> = {
      filterProcessor: {},
      idempotencyProcessor: {},
      inputProcessor: {}
    };

    const merged = applyProcessorFieldOverrides(
      mergeDefinitionPatch(existing, patch),
      patch,
      ["filterProcessor", "idempotencyProcessor", "inputProcessor"]
    );

    expect(merged.filterProcessor).toEqual({});
    expect(merged.idempotencyProcessor).toEqual({});
    expect(merged.inputProcessor).toEqual({});
  });

  it("preserves normal merge behavior for non-empty processor patches", () => {
    const existing: Pick<EventSourceDefinition, "normalizationProcessor"> = {
      normalizationProcessor: {
        mode: "JSON_PATH",
        jsonPath: { fields: { eventType: "$.headers.X-Type" } }
      }
    };
    const patch: Partial<Pick<EventSourceDefinition, "normalizationProcessor">> = {
      normalizationProcessor: {
        mode: "TEMPLATE",
        template: { engine: "MUSTACHE", template: { eventType: "{{headers.X-Type}}" } }
      }
    };

    const merged = applyProcessorFieldOverrides(
      mergeDefinitionPatch(existing, patch),
      patch,
      ["normalizationProcessor"]
    );

    expect(merged.normalizationProcessor).toEqual(patch.normalizationProcessor);
  });

  it("preserves merged processor fields for partial non-empty processor patches", () => {
    const existing: Pick<EventTrigger, "inputProcessor"> = {
      inputProcessor: {
        mode: "SCRIPT_REF",
        scriptRef: { scriptId: "processor-1", versionMode: "DRAFT" }
      }
    };
    const patch: Partial<Pick<EventTrigger, "inputProcessor">> = {
      inputProcessor: {
        scriptRef: { versionMode: "PUBLISHED" }
      }
    };

    const merged = applyProcessorFieldOverrides(
      mergeDefinitionPatch(existing, patch),
      patch,
      ["inputProcessor"]
    );

    expect(merged.inputProcessor).toEqual({
      mode: "SCRIPT_REF",
      scriptRef: { scriptId: "processor-1", versionMode: "PUBLISHED" }
    });
  });
});
