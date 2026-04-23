import { Tabs } from "antd";
import { CommandPanel } from "./CommandPanel";

interface CommandTabItem {
  command: string;
  key: string;
  label: string;
  title: string;
  variants?: Array<{
    command: string;
    key: string;
    label: string;
  }>;
}

export function CommandTabsPanel({
  items,
  onCopy
}: {
  items: CommandTabItem[];
  onCopy: (value: string) => void;
}) {
  return (
    <Tabs
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        children: <CommandPanel title={item.title} command={item.command} variants={item.variants} onCopy={onCopy} />
      }))}
    />
  );
}
