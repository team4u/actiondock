import { Tag } from "antd";
import type { RepositoryUsage } from "../../shared/types";

export function UsageTag({ usage }: { usage?: RepositoryUsage }) {
  return usage === "DEVELOPMENT" ? <Tag color="purple">开发仓库</Tag> : <Tag color="blue">普通分发</Tag>;
}
