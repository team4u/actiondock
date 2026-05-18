import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScriptCommandsTab } from "./ScriptCommandsTab";

describe("ScriptCommandsTab", () => {
  it("renders the skill example section alongside command presets", () => {
    const html = renderToStaticMarkup(
      <ScriptCommandsTab
        currentScriptId="hello-groovy"
        origin="http://localhost:8080"
        apiKey="secret-token"
        executionMode="ASYNC"
        commandInput={{ source: "current-json", value: { name: "Alice" } }}
        detailCommandPresets={[
          { key: "detail-cli", family: "CLI", environment: "bash/zsh", command: "actiondock script get 'hello-groovy'" }
        ]}
        executeCommandPresets={[
          { key: "execute-cli", family: "CLI", environment: "bash/zsh", command: "actiondock script run 'hello-groovy' --name 'Alice'" }
        ]}
        schemaCommandPresets={[
          { key: "schema-cli", family: "CLI", environment: "bash/zsh", command: "actiondock script schema 'hello-groovy'" }
        ]}
        hasInputSchema={true}
        hasOutputSchema={true}
        skillExample={"---\nname: actiondock-script-hello-groovy\n---"}
        toolContractResponseExample={{ data: { input: [], output: [] } }}
        onCopy={() => undefined}
      />
    );

    expect(html).toContain("Skill 示例");
    expect(html).toContain("执行脚本");
    expect(html).toContain("Schema");
  });
});
