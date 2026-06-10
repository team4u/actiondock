import { Tag } from "antd";

export function RiskLevelTag({ level }: { level?: string }) {
  if (!level) {
    return <Tag>未声明</Tag>;
  }
  const normalized = level.toUpperCase();
  const color = normalized === "HIGH" ? "red" : normalized === "MEDIUM" ? "gold" : "green";
  return <Tag color={color}>{normalized}</Tag>;
}
