import { Tag } from "antd";
import type { RepositoryTrustLevel } from "../../shared/types";

export function TrustLevelTag({ level }: { level: RepositoryTrustLevel }) {
  return level === "TRUSTED" ? <Tag color="green">可信</Tag> : <Tag color="gold">未信任</Tag>;
}
