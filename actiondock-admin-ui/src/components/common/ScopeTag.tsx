import { Tag } from "antd";
import type { ScriptScope } from "../../shared/types";

const SCOPE_LABELS: Record<string, string> = {
  REPOSITORY: "仓库",
  SAMPLE: "示例",
  PERSONAL: "本机"
};

const SCOPE_COLORS: Record<string, string> = {
  REPOSITORY: "blue",
  SAMPLE: "purple",
  PERSONAL: "green"
};

export function getScopeLabel(scope?: ScriptScope): string {
  return SCOPE_LABELS[scope ?? "PERSONAL"] ?? "本机";
}

export function ScopeTag({ scope }: { scope?: ScriptScope }) {
  return <Tag color={SCOPE_COLORS[scope ?? "PERSONAL"] ?? "green"}>{getScopeLabel(scope)}</Tag>;
}
