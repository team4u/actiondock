import { Tag } from "antd";
import type { UpstreamSyncState } from "../../shared/types";

interface UpstreamSyncTagProps {
  state?: UpstreamSyncState;
  defaultLabel?: string;
  defaultColor?: string;
  divergedLabel?: string;
}

export function UpstreamSyncTag({
  state,
  defaultLabel = "上游同步",
  defaultColor = "purple",
  divergedLabel = "有冲突"
}: UpstreamSyncTagProps) {
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

export function getUpstreamActionLabel(state?: UpstreamSyncState): string {
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
      return "打开工作副本";
  }
}
