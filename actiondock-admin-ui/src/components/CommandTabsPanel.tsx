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

export function buildStandardCommandPresets(params: {
  keyPrefix: string;
  httpBash: string;
  httpPowerShell: string;
  cliBash: string;
  cliPowerShell: string;
  cliPowerShellEnvironment?: string;
  cliCmd: string;
}): CommandPreset[] {
  return buildCommandPresets([
    { key: `${params.keyPrefix}-http-bash`, family: "HTTP", environment: "bash/zsh", command: params.httpBash },
    { key: `${params.keyPrefix}-http-powershell`, family: "HTTP", environment: "PowerShell", command: params.httpPowerShell },
    { key: `${params.keyPrefix}-cli-bash`, family: "CLI", environment: "bash/zsh", command: params.cliBash },
    { key: `${params.keyPrefix}-cli-powershell`, family: "CLI", environment: params.cliPowerShellEnvironment ?? "PowerShell", command: params.cliPowerShell },
    { key: `${params.keyPrefix}-cli-cmd`, family: "CLI", environment: "cmd", command: params.cliCmd }
  ]);
}
