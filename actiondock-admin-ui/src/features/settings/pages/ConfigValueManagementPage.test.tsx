import { describe, expect, it } from "vitest";
import { buildDetailFormValues, buildDetailValueFieldState, buildReferenceItems } from "./ConfigValueManagementPage";
import type { ConfigValueDetail } from "../../../shared/types";

const baseDetail: ConfigValueDetail = {
  key: "openai.api_key",
  value: "sk-live",
  valueMasked: "sk-****",
  hasValue: true,
  description: "API key",
  secret: true,
  managed: false,
  overridden: false,
  usage: {
    configReferences: [],
    scriptReferences: [],
    scheduleReferences: [],
    pluginConfigReferences: [],
    templateDeclarations: [],
    modelReferences: []
  },
  impactedScripts: [],
  availableActions: {
    canCopyAsLocalOverride: false,
    canRestoreRepositoryDefault: false
  }
};

describe("ConfigValueManagementPage helpers", () => {
  it("builds secret detail form values without exposing the current value", () => {
    expect(buildDetailFormValues(baseDetail)).toEqual({
      key: "openai.api_key",
      value: "",
      description: "API key",
      secret: true,
      preserveValue: true
    });
  });

  it("keeps plain-text values editable for non-secret details", () => {
    expect(buildDetailFormValues({
      ...baseDetail,
      secret: false,
      value: "https://svc.example.com",
      hasValue: true
    })).toEqual({
      key: "openai.api_key",
      value: "https://svc.example.com",
      description: "API key",
      secret: false,
      preserveValue: false
    });
  });

  it("shows preserve-value behavior for secret details with an existing value", () => {
    expect(buildDetailValueFieldState(baseDetail, {
      secret: true,
      preserveValue: true,
      editable: true
    })).toEqual({
      showPreserveValue: true,
      valueInputDisabled: true
    });
  });

  it("keeps the value input editable when preserve-value is off", () => {
    expect(buildDetailValueFieldState(baseDetail, {
      secret: true,
      preserveValue: false,
      editable: true
    })).toEqual({
      showPreserveValue: true,
      valueInputDisabled: false
    });
  });

  it("does not show preserve-value controls for non-secret details", () => {
    expect(buildDetailValueFieldState({
      ...baseDetail,
      secret: false
    }, {
      secret: false,
      preserveValue: false,
      editable: true
    })).toEqual({
      showPreserveValue: false,
      valueInputDisabled: false
    });
  });

  it("keeps the value input disabled when the detail is read-only", () => {
    expect(buildDetailValueFieldState(baseDetail, {
      secret: true,
      preserveValue: false,
      editable: false
    })).toEqual({
      showPreserveValue: true,
      valueInputDisabled: true
    });
  });

  it("builds reference snippets from the normalized key", () => {
    expect(buildReferenceItems(" openai.api_key ")).toEqual([
      { label: "JSON 配置值", value: "${config.openai.api_key}" },
      { label: "Bearer / 前缀拼接", value: "Bearer ${config.openai.api_key}" },
      { label: "Groovy 脚本", value: "config[\"openai.api_key\"]" },
      { label: "Python 脚本", value: "config.get(\"openai.api_key\")" },
      {
        label: "插件调用参数",
        value: "plugins.invoke(\"plugin-id\", \"action\", [token: \"${config.openai.api_key}\"])"
      }
    ]);
  });

  it("returns no reference snippets for a blank key", () => {
    expect(buildReferenceItems("   ")).toEqual([]);
  });
});
