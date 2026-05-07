import { Tag } from "antd";
import type { DevelopmentSyncState } from "../../shared/types";

interface DevelopmentSyncTagProps {
  state?: DevelopmentSyncState;
  defaultLabel?: string;
  defaultColor?: string;
  divergedLabel?: string;
}

export function DevelopmentSyncTag({
  state,
  defaultLabel = "开发同步",
  defaultColor = "purple",
  divergedLabel = "有冲突"
}: DevelopmentSyncTagProps) {
  switch (state) {
    case "LOCAL_CHANGES":
      return <Tag color="orange">本地有修改</Tag>;
    case "REMOTE_CHANGES":
      return <Tag color="processing">远端有更新</Tag>;
    case "DIVERGED":
      return <Tag color="red">{divergedLabel}</Tag>;
    case "SYNCED":
      return <Tag color="purple">已同步</Tag>;
    default:
      return <Tag color={defaultColor}>{defaultLabel}</Tag>;
  }
}

export function getDevelopmentActionLabel(state?: DevelopmentSyncState): string {
  switch (state) {
    case "LOCAL_CHANGES":
      return "本地有修改";
    case "REMOTE_CHANGES":
      return "远端有更新";
    case "DIVERGED":
      return "有冲突";
    case "SYNCED":
      return "已同步";
    default:
      return "打开开发脚本";
  }
}
