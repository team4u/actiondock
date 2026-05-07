import { describe, expect, it } from "vitest";
import { parseGeneratedScriptText } from "./generatedScript";

function parseSchemaText(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

describe("parseGeneratedScriptText", () => {
  it("keeps explicit schemas from the fixed five-section format", () => {
    const parsed = parseGeneratedScriptText(`### 脚本 ID
hello-groovy

### 脚本名称
Hello Groovy

### Groovy 脚本
\`\`\`groovy
def name = input.name ?: "World"
return [message: "Hello, \${name}!"]
\`\`\`

### Input Schema
\`\`\`json
{
  "type": "object",
  "properties": {
    "manualName": {
      "type": "string"
    }
  }
}
\`\`\`

### Output Schema
\`\`\`json
{
  "type": "object",
  "properties": {
    "manualMessage": {
      "type": "string"
    }
  }
}
\`\`\``);

    expect(parsed.id).toBe("hello-groovy");
    expect(parsed.name).toBe("Hello Groovy");
    expect(parsed.type).toBe("GROOVY");
    expect(parsed.source).toContain('def name = input.name ?: "World"');
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        manualName: {
          type: "string"
        }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        manualMessage: {
          type: "string"
        }
      }
    });
  });

  it("infers input and output schemas from raw Groovy source", () => {
    const parsed = parseGeneratedScriptText(`### 脚本 ID
hello-inferred

### 脚本名称
Hello Inferred

### Groovy 脚本
\`\`\`groovy
def name = input.name ?: "World"
def age = input["age"]
def active = input["active"]

return [
  message: "Hello, \${name}!",
  count: 1,
  enabled: true
]
\`\`\`

### Input Schema（输入参数）
\`\`\`json
{
  "type": "object",
  "properties": {}
}
\`\`\`

### Output Schema（输出结果）
\`\`\`json
{
  "type": "object",
  "properties": {}
}
\`\`\``);

    expect(parsed.id).toBe("hello-inferred");
    expect(parsed.name).toBe("Hello Inferred");
    expect(parsed.type).toBe("GROOVY");
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "string" },
        active: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        count: { type: "integer" },
        enabled: { type: "boolean" }
      }
    });
  });

  it("infers schemas from the Groovy section when README-format schemas are empty", () => {
    const parsed = parseGeneratedScriptText(`### 脚本 ID
partial-script

### 脚本名称
Partial Script

### Groovy 脚本
\`\`\`groovy
def region = input.region
if (region == "cn") {
  return [message: "你好", code: 200]
}
return [message: "hello"]
\`\`\`

### Input Schema（输入参数）
\`\`\`json
{
  "type": "object",
  "properties": {}
}
\`\`\`

### Output Schema（输出结果）
\`\`\`json
{}
\`\`\``);

    expect(parsed.id).toBe("partial-script");
    expect(parsed.name).toBe("Partial Script");
    expect(parsed.type).toBe("GROOVY");
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        region: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        code: { type: "integer" }
      }
    });
  });

  it("infers schemas from a standalone Groovy code block", () => {
    const parsed = parseGeneratedScriptText(`下面是脚本：

\`\`\`groovy
def orderId = input["orderId"]
return [status: "ok", retry: false]
\`\`\`
`);

    expect(parsed.id).toBeUndefined();
    expect(parsed.name).toBeUndefined();
    expect(parsed.type).toBe("GROOVY");
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        orderId: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        status: { type: "string" },
        retry: { type: "boolean" }
      }
    });
  });

  it("infers schemas from raw Groovy source without wrappers", () => {
    const parsed = parseGeneratedScriptText(`
def region = input.region
if (region == "cn") {
  return [message: "你好", code: 200]
}
return [message: "fallback"]
`);

    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        region: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        code: { type: "integer" }
      }
    });
  });

  it("parses Python fixed-format scripts and infers schemas from python source", () => {
    const parsed = parseGeneratedScriptText(`### 脚本 ID
hello-python

### 脚本名称
Hello Python

### Python 脚本
\`\`\`python
name = input.get("name") or "World"
return {"message": f"Hello, {name}!", "enabled": True}
\`\`\`

### Input Schema
\`\`\`json
{}
\`\`\`

### Output Schema
\`\`\`json
{}
\`\`\``);

    expect(parsed.type).toBe("PYTHON");
    expect(parsed.source).toContain('input.get("name")');
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        enabled: { type: "boolean" }
      }
    });
  });

  it("infers Python source without wrappers", () => {
    const parsed = parseGeneratedScriptText(`
name = input.get("name") or "World"
return {"message": f"Hello, {name}!", "count": 1}
`);

    expect(parsed.type).toBe("PYTHON");
    expect(parseSchemaText(parsed.inputSchemaText)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" }
      }
    });
    expect(parseSchemaText(parsed.outputSchemaText)).toEqual({
      type: "object",
      properties: {
        message: { type: "string" },
        count: { type: "integer" }
      }
    });
  });
});
