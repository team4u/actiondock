import { Tag } from "antd";
import type { AiCapability, AiRunStatus, AiToolPermission } from "../../shared/types";

export function AiCapabilityTag({ capability }: { capability: AiCapability }) {
  return <Tag color={capability === "AGENT_RUN" ? "purple" : capability === "EMBEDDING" ? "gold" : "blue"}>{capability}</Tag>;
}

export function AiToolPermissionTag({ permission }: { permission: AiToolPermission }) {
  const color = permission === "DANGEROUS_ACTION" ? "red" : permission === "CONTROLLED_ACTION" ? "orange" : permission === "PROPOSE_CHANGE" ? "green" : "blue";
  return <Tag color={color}>{permission}</Tag>;
}

export function AiRunStatusTag({ status }: { status: AiRunStatus }) {
  const color = status === "SUCCESS" ? "green" : status === "FAILED" ? "red" : status === "WAITING_APPROVAL" ? "orange" : status === "RUNNING" ? "processing" : "default";
  return <Tag color={color}>{status}</Tag>;
}
