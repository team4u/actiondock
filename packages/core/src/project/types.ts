export type ConfigValueType = "string" | "number" | "boolean" | "object" | "array";

export interface ConfigItemDefinition {
  description?: string;
  default?: unknown;
  secret?: boolean;
  type?: ConfigValueType;
  env?: string | string[];
}

export interface ProjectConfig {
  id: string;
  name: string;
  version: string;
  description?: string;
  actionsDir?: string;
  playbooksDir?: string;
  config?: Record<string, ConfigItemDefinition>;
}

export interface PlaybookFrontmatter {
  id: string;
  description?: string;
  actions?: string[];
}

export interface PlaybookDefinition extends PlaybookFrontmatter {
  content: string;
  filePath: string;
}
