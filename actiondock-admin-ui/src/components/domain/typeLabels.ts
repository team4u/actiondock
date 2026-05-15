import type { RepositoryDefinition, RepositoryScriptDescriptor } from "../../shared/types";

export function getRepositoryTypeLabel(type: RepositoryDefinition["type"]): string {
  switch (type) {
    case "LOCAL_DIR":
      return "本地目录";
    case "HTTP":
      return "HTTP";
    default:
      return "Git";
  }
}

export function getScriptTypeLabel(type: RepositoryScriptDescriptor["type"]): string {
  return type === "PYTHON" ? "Python" : "Groovy";
}
