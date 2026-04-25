import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownDescription } from "./MarkdownDescription";

describe("MarkdownDescription", () => {
  it("renders GitHub-flavored markdown without raw html", () => {
    const html = renderToStaticMarkup(
      <MarkdownDescription
        value={`## Usage

- Install
- Run

| Key | Value |
| --- | --- |
| mode | safe |

\`tool.run()\`

<script>alert("x")</script>`}
      />
    );

    expect(html).toContain("<h2>Usage</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>tool.run()</code>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops unsafe link protocols", () => {
    const html = renderToStaticMarkup(
      <MarkdownDescription value="[bad](javascript:alert(1)) [good](https://example.com)" />
    );

    expect(html).not.toContain("javascript:alert");
    expect(html).toContain('href="https://example.com"');
  });
});
