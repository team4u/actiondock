import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillExamplePanel } from "./SkillExamplePanel";

describe("SkillExamplePanel", () => {
  it("renders the preview and copy affordance", () => {
    const html = renderToStaticMarkup(
      <SkillExamplePanel
        description="给模型的调用说明。"
        value={"---\nname: actiondock-script-hello\n---"}
        onCopy={() => undefined}
        onOpenInstall={() => undefined}
      />
    );

    expect(html).toContain("复制 Skill");
    expect(html).toContain("安装为 Skill");
    expect(html).toContain("actiondock-script-hello");
    expect(html).toContain("给模型的调用说明。");
  });
});
