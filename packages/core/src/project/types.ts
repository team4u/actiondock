export interface ConfigItemDefinition {
  description?: string;
  default?: unknown;
  secret?: boolean;
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
