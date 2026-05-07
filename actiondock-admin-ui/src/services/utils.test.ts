import { describe, expect, it } from "vitest";
import { toSingleLineCommand } from "./utils";

describe("toSingleLineCommand", () => {
  it("flattens shell continuation lines for copy", () => {
    expect(
      toSingleLineCommand(`actiondock \\
  --base-url 'http://localhost:8080' \\
  scripts get 'hello-groovy'`)
    ).toBe("actiondock --base-url 'http://localhost:8080' scripts get 'hello-groovy'");
  });

  it("keeps single line commands unchanged", () => {
    expect(toSingleLineCommand("actiondock scripts list")).toBe(
      "actiondock scripts list"
    );
  });
});
