import { describe, expect, it } from "vitest";
import { toSingleLineCommand } from "./utils";

describe("toSingleLineCommand", () => {
  it("flattens shell continuation lines for copy", () => {
    expect(
      toSingleLineCommand(`java -jar actiondock-cli.jar \\
  --base-url 'http://localhost:8080' \\
  scripts get 'hello-groovy'`)
    ).toBe("java -jar actiondock-cli.jar --base-url 'http://localhost:8080' scripts get 'hello-groovy'");
  });

  it("keeps single line commands unchanged", () => {
    expect(toSingleLineCommand("java -jar actiondock-cli.jar scripts list")).toBe(
      "java -jar actiondock-cli.jar scripts list"
    );
  });
});
