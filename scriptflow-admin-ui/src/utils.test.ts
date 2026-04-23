import { describe, expect, it } from "vitest";
import { toSingleLineCommand } from "./utils";

describe("toSingleLineCommand", () => {
  it("flattens shell continuation lines for copy", () => {
    expect(
      toSingleLineCommand(`java -jar scriptflow-cli.jar \\
  --base-url 'http://localhost:8080' \\
  scripts get 'hello-groovy'`)
    ).toBe("java -jar scriptflow-cli.jar --base-url 'http://localhost:8080' scripts get 'hello-groovy'");
  });

  it("keeps single line commands unchanged", () => {
    expect(toSingleLineCommand("java -jar scriptflow-cli.jar scripts list")).toBe(
      "java -jar scriptflow-cli.jar scripts list"
    );
  });
});
