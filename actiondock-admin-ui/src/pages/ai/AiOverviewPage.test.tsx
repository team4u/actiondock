import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiOutlined } from "@ant-design/icons";
import { AiManagementCard } from "./AiOverviewPage";

describe("AiManagementCard", () => {
  it("renders management actions and warnings", () => {
    const html = renderToStaticMarkup(
      <AiManagementCard
        title="模型管理"
        value={2}
        meta="3 个模型 Profile"
        icon={<ApiOutlined />}
        warning="1 个启用模型未引用 API Key 配置值"
        onManage={() => undefined}
        onCreate={() => undefined}
      />
    );

    expect(html).toContain("模型管理");
    expect(html).toContain("3 个模型 Profile");
    expect(html).toContain("1 个启用模型未引用 API Key 配置值");
    expect(html).toContain("管理");
    expect(html).toContain("新建");
  });
});
