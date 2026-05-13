import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SchemaObjectResultView } from "./SchemaObjectResultView";

vi.mock("../common/CodeEditor", () => ({
  CodeEditor: ({
    value,
    language,
    readOnly
  }: {
    value?: string;
    language?: string;
    readOnly?: boolean;
  }) => (
    <pre data-testid="code-editor" data-language={language} data-readonly={String(readOnly)}>
      {value}
    </pre>
  )
}));

vi.mock("../common/MarkdownDescription", () => ({
  MarkdownDescription: ({ value }: { value?: string }) => (
    <div data-testid="markdown-description">{value}</div>
  )
}));

describe("SchemaObjectResultView", () => {
  it("renders markdown fields with markdown renderer", () => {
    const html = renderToStaticMarkup(
      <SchemaObjectResultView
        schema={{
          type: "object",
          properties: {
            summary: {
              type: "string",
              title: "Summary",
              "x-ui": { widget: "markdown" }
            }
          }
        }}
        value={{ summary: "# Hello" }}
      />
    );

    expect(html).toContain("markdown-description");
    expect(html).toContain("# Hello");
  });

  it("renders json fields with the json code editor", () => {
    const html = renderToStaticMarkup(
      <SchemaObjectResultView
        schema={{
          type: "object",
          properties: {
            payload: {
              type: "string",
              title: "Payload",
              "x-ui": { widget: "json", rows: 8 }
            }
          }
        }}
        value={{ payload: '{"ok":true}' }}
      />
    );

    expect(html).toContain('data-testid="code-editor"');
    expect(html).toContain('data-language="json"');
    expect(html).toContain('{&quot;ok&quot;:true}');
  });

  it("renders code fields with the configured language", () => {
    const html = renderToStaticMarkup(
      <SchemaObjectResultView
        schema={{
          type: "object",
          properties: {
            script: {
              type: "string",
              title: "Script",
              "x-ui": { widget: "code", language: "python", rows: 12 }
            }
          }
        }}
        value={{ script: "print('hi')" }}
      />
    );

    expect(html).toContain('data-testid="code-editor"');
    expect(html).toContain('data-language="python"');
    expect(html).toContain("print(&#x27;hi&#x27;)");
  });
});
