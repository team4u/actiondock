import { CommandPanel, type CommandPreset } from "./CommandPanel";

export interface CommandPanelGroup {
  presets: CommandPreset[];
  title: string;
}

export function CommandTabsPanel({
  title,
  presets,
  onCopy
}: {
  title: string;
  presets: CommandPanelGroup["presets"];
  onCopy: (value: string) => void;
}) {
  return <CommandPanel title={title} presets={presets} onCopy={onCopy} />;
}

export type { CommandPreset } from "./CommandPanel";

export function buildCommandPresets(presets: CommandPreset[]): CommandPreset[] {
  return presets.filter((item) => item.command.trim().length > 0);
}
