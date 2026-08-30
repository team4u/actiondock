import { basename } from "node:path";
import type { ActionDefinition } from "@actiondock/sdk";
import type { PlaybookDefinition, ProjectConfig } from "../project/types";

export function generateSkillMd(
  config: ProjectConfig,
  actions: ActionDefinition[],
  playbooks: PlaybookDefinition[],
  binaryRelPath = "./bin/action-bin"
): string {
  const actionListMd = actions
    .map((a) => {
      const desc = a.description ? ` - ${a.description}` : "";
      let params = "";
      if (
        a.inputSchema &&
        typeof a.inputSchema === "object" &&
        (a.inputSchema as any).properties
      ) {
        const props = Object.keys((a.inputSchema as any).properties);
        const req = (a.inputSchema as any).required || [];
        params = `\n  - Parameters: ${props
          .map((p) => (req.includes(p) ? `\`${p}\` (required)` : `\`${p}\``))
          .join(", ")}`;
      }
      return `* \`${a.id}\`${desc}${params}`;
    })
    .join("\n");

  let playbookSection = "";
  if (playbooks.length > 0) {
    const list = playbooks
      .map((p) => {
        const rel = `./playbooks/${basename(p.filePath)}`;
        return `* **${p.id}** (\`${rel}\`): ${p.description || "Task guide"}`;
      })
      .join("\n");
    playbookSection = `
## Available Playbooks (Task SOPs)

Playbooks provide step-by-step guidance for complex tasks. Read the playbook markdown files for domain SOPs:

${list}
`;
  }

  return `# ${config.name} (${config.id})

${config.description || "Standalone AI Agent Actions."}

## How to Run Actions

Use the included standalone executable \`${binaryRelPath}\` to discover and execute actions.
The tool requires no pre-installed dependencies (no Node, Bun, Python, or Java needed).

### 1. Discover available actions
\`\`\`bash
${binaryRelPath} list --json
\`\`\`

### 2. Inspect an action schema & parameters
\`\`\`bash
${binaryRelPath} describe <action-id> --json
\`\`\`

### 3. Execute an action
\`\`\`bash
${binaryRelPath} run <action-id> --input '{"param": "value"}'
\`\`\`

All actions write a structured JSON envelope to \`stdout\`:
\`\`\`json
{
  "ok": true,
  "runId": "01J...",
  "data": { ... }
}
\`\`\`
Diagnostics and logs are written to \`stderr\`.

---

## Action Catalog

${actionListMd}
${playbookSection}
---

## Runtime State and Configuration

The executable manages its local SQLite state store automatically.
You can configure options or inspect state when needed:

\`\`\`bash
# Manage config
${binaryRelPath} config list
${binaryRelPath} config set KEY VALUE

# Manage state
${binaryRelPath} state list
${binaryRelPath} state get KEY
\`\`\`
`;
}

export function generateSkillJson(
  config: ProjectConfig,
  actions: ActionDefinition[],
  binaryName: string,
  target: string
): string {
  const manifest = {
    schemaVersion: "2.0.0",
    packageId: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    target,
    executable: `./bin/${binaryName}`,
    actions: actions.map((a) => ({
      id: a.id,
      description: a.description,
      inputSchema: a.inputSchema,
      outputSchema: a.outputSchema,
    })),
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(manifest, null, 2) + "\n";
}
