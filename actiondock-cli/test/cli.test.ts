import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliDir = path.resolve(import.meta.dirname, "..");

let server: http.Server;
let baseUrl = "";
const requests: Array<{
  method?: string;
  url?: string;
  body?: unknown;
  bodyText?: string;
  headers: http.IncomingHttpHeaders;
}> = [];

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const bodyText = await readBody(req);
    const contentType = req.headers["content-type"] ?? "";
    const body = bodyText && `${contentType}`.includes("application/json") ? JSON.parse(bodyText) : undefined;
    requests.push({ method: req.method, url: req.url ?? "", body, bodyText, headers: req.headers });

    if (req.method === "GET" && req.url === "/api/scripts") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          { id: "published-tool", name: "Published Tool", type: "GROOVY", publishedSnapshot: { inputSchema: {} } },
          { id: "draft-only-tool", name: "Draft Tool", type: "PYTHON", publishedSnapshot: null }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "published-tool",
          name: "Published Tool",
          type: "GROOVY",
          status: "DRAFT",
          version: 7,
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" }
            }
          },
          publishedSnapshot: {
            inputSchema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" }
              }
            }
          }
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/published") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "published-tool",
          name: "Published Tool",
          publishedSnapshot: {
            inputSchema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                count: { type: "integer" },
                payload: { type: "object" }
              }
            }
          }
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/published/execute") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "exec-1",
          status: "SUCCESS",
          output: body
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/executions/exec-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "exec-1",
          scriptId: "published-tool",
          status: "SUCCESS",
          submitMode: "SYNC",
          triggerSource: "MANUAL",
          input: { name: "Alice" },
          output: { ok: true },
          logs: []
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/executions?scriptId=published-tool") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "exec-1",
            scriptId: "published-tool",
            status: "SUCCESS",
            submitMode: "SYNC",
            triggerSource: "MANUAL",
            input: { name: "Alice" },
            output: { ok: true },
            logs: []
          },
          {
            id: "exec-2",
            scriptId: "published-tool",
            status: "RUNNING",
            submitMode: "ASYNC",
            triggerSource: "MANUAL",
            input: {},
            output: {},
            logs: []
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/executions?scheduleId=schedule-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "exec-schedule-1",
            scriptId: "published-tool",
            scheduleId: "schedule-1",
            status: "SUCCESS",
            submitMode: "ASYNC",
            triggerSource: "SCHEDULED",
            input: { name: "Alice" },
            output: { ok: true },
            logs: []
          }
        ]
      });
    }

    if (req.method === "DELETE" && req.url === "/api/executions/exec-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "DELETE" && req.url === "/api/executions?scriptId=published-tool") {
      return json(res, {
        status: 0,
        msg: "cleared",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/schedules") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "schedule-1",
            scriptId: "published-tool",
            name: "Nightly Sync",
            cronExpression: "0 0 * * * *",
            input: {
              name: "Alice",
              payload: { scope: "night" }
            },
            enabled: true,
            nextRunAt: "2026-04-29T00:00:00",
            lastExecutionId: "exec-schedule-1",
            lastExecutionStatus: "SUCCESS"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/schedules") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "schedule-1",
            scriptId: "published-tool",
            name: "Nightly Sync",
            cronExpression: "0 0 * * * *",
            input: {
              name: "Alice",
              payload: { scope: "night" }
            },
            enabled: true
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/schedules/schedule-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "schedule-1",
          scriptId: "published-tool",
          name: "Nightly Sync",
          cronExpression: "0 0 * * * *",
          input: {
            name: "Alice",
            payload: { scope: "night" }
          },
          enabled: true,
          nextRunAt: "2026-04-29T00:00:00",
          lastExecutionId: "exec-schedule-1",
          lastExecutionStatus: "SUCCESS"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/schedules") {
      return json(res, {
        status: 0,
        msg: "created",
        data: {
          id: "schedule-2",
          scriptId: body?.scriptId,
          name: body?.name,
          cronExpression: body?.cronExpression,
          input: body?.input ?? {},
          enabled: body?.enabled ?? true
        }
      });
    }

    if (req.method === "PUT" && req.url === "/api/schedules/schedule-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          id: "schedule-1",
          scriptId: body?.scriptId,
          name: body?.name,
          cronExpression: body?.cronExpression,
          input: body?.input ?? {},
          enabled: body?.enabled ?? true
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/schedules/schedule-1/enable") {
      return json(res, {
        status: 0,
        msg: "enabled",
        data: {
          id: "schedule-1",
          scriptId: "published-tool",
          name: "Nightly Sync",
          cronExpression: "0 0 * * * *",
          input: {
            name: "Alice"
          },
          enabled: true
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/schedules/schedule-1/disable") {
      return json(res, {
        status: 0,
        msg: "disabled",
        data: {
          id: "schedule-1",
          scriptId: "published-tool",
          name: "Nightly Sync",
          cronExpression: "0 0 * * * *",
          input: {
            name: "Alice"
          },
          enabled: false
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/schedules/schedule-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            pluginId: "plugin-a",
            name: "Plugin A",
            version: "1.2.3",
            state: "STARTED",
            started: true,
            configurable: true,
            actions: [
              { action: "summarize" }
            ]
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins/references") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            pluginId: "plugin-a",
            name: "Plugin A",
            version: "1.2.3",
            sourceType: "SYSTEM",
            started: true,
            actions: [
              { action: "summarize" }
            ]
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins/plugin-a") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          pluginId: "plugin-a",
          name: "Plugin A",
          version: "1.2.3",
          actions: [
            {
              action: "summarize",
              inputSchema: {
                type: "object",
                required: ["topic"],
                properties: {
                  topic: { type: "string" },
                  retries: { type: "integer" },
                  payload: { type: "object" }
                }
              }
            }
          ]
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins/plugin-a/config") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          pluginId: "plugin-a",
          configSchema: {
            type: "object",
            properties: {
              endpoint: { type: "string" }
            }
          },
          defaultConfig: {
            endpoint: "http://localhost"
          },
          config: {
            endpoint: "http://service.internal"
          }
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/plugins/plugin-a/actions/summarize/invoke") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          pluginId: "plugin-a",
          action: "summarize",
          result: body
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/plugins/install") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          pluginId: "uploaded-plugin",
          version: "0.1.0",
          actions: []
        }
      });
    }

    if (req.method === "PUT" && req.url === "/api/shared-state") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          namespace: body?.namespace,
          key: body?.key,
          value: body?.value,
          secret: body?.secret ?? false,
          version: 1,
          expiresAt: body?.expiresAt ?? null
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/shared-state/namespaces") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: ["oauth.github", "cursor.sync"]
      });
    }

    if (req.method === "GET" && req.url === "/api/shared-state?namespace=oauth.github") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            namespace: "oauth.github",
            key: "access-token",
            secret: true,
            version: 7
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/shared-state/detail?namespace=oauth.github&key=access-token") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          namespace: "oauth.github",
          key: "access-token",
          value: {
            accessToken: "gho_xxx"
          },
          secret: true,
          version: 7
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/shared-state/cas") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          updated: true,
          entry: {
            namespace: body?.namespace,
            key: body?.key,
            value: body?.value,
            version: body?.expectedVersion + 1
          },
          current: null
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/shared-state?namespace=oauth.github&key=access-token") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/shared-state/purge-expired?namespace=oauth.github") {
      return json(res, {
        status: 0,
        msg: "purged",
        data: 2
      });
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to start test server");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("CLI integration", () => {
  it("lists published tools by default", async () => {
    const result = await runCli(["tool", "list", "--server", baseUrl]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("published-tool");
    expect(result.stdout).not.toContain("draft-only-tool");
  });

  it("returns schema detail as JSON", async () => {
    const result = await runCli(["tool", "schema", "published-tool", "--server", baseUrl, "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        target: "published",
        flagFields: [
          expect.objectContaining({ name: "name" }),
          expect.objectContaining({ name: "count" })
        ],
        jsonOnlyFields: [
          expect.objectContaining({ name: "payload" })
        ]
      })
    );
  });

  it("runs a published tool with flat flags and merged JSON input", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-test-"));
    const inputFile = path.join(tempDir, "input.json");
    fs.writeFileSync(inputFile, JSON.stringify({ payload: { source: "file" } }));

    const result = await runCli([
      "tool",
      "run",
      "published-tool",
      "--server",
      baseUrl,
      "--input-file",
      inputFile,
      "--name",
      "Alice",
      "--count",
      "3",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        id: "exec-1",
        status: "SUCCESS"
      })
    );

    const executionRequest = requests.find((item) => item.url === "/api/scripts/published-tool/published/execute");
    expect(executionRequest?.body).toEqual({
      input: {
        payload: { source: "file" },
        name: "Alice",
        count: 3
      },
      mode: "SYNC",
      responseView: "RESULT"
    });
  });

  it("reads tool detail for draft with json output", async () => {
    const result = await runCli(["tool", "get", "published-tool", "--draft", "--server", baseUrl, "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        id: "published-tool",
        version: 7
      })
    );
  });

  it("queries execution detail and list", async () => {
    const detail = await runCli(["execution", "get", "exec-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "exec-1",
        scriptId: "published-tool"
      })
    );

    const list = await runCli(["execution", "list", "--script-id", "published-tool", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(2);

    const scheduleList = await runCli(["execution", "list", "--schedule-id", "schedule-1", "--server", baseUrl, "--json"]);
    expect(scheduleList.status).toBe(0);
    expect(JSON.parse(scheduleList.stdout)).toEqual([
      expect.objectContaining({
        id: "exec-schedule-1",
        scheduleId: "schedule-1"
      })
    ]);
  });

  it("deletes and clears execution records", async () => {
    expect((await runCli(["execution", "delete", "exec-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["execution", "clear", "--script-id", "published-tool", "--server", baseUrl, "--json"])).status).toBe(0);
  });

  it("manages schedules with flat flags", async () => {
    const list = await runCli(["schedule", "list", "--script-id", "published-tool", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "schedule-1",
        scriptId: "published-tool"
      })
    ]);

    const detail = await runCli(["schedule", "get", "schedule-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "schedule-1",
        cronExpression: "0 0 * * * *"
      })
    );

    const created = await runCli([
      "schedule",
      "create",
      "--script-id",
      "published-tool",
      "--schedule-name",
      "Hourly Sync",
      "--schedule-cron",
      "0 */5 * * * *",
      "--input-json",
      '{"payload":{"source":"file"}}',
      "--name",
      "Alice",
      "--count",
      "3",
      "--schedule-disabled",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(created.status).toBe(0);
    expect(JSON.parse(created.stdout)).toEqual(
      expect.objectContaining({
        id: "schedule-2",
        enabled: false
      })
    );

    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/schedules");
    expect(createRequest?.body).toEqual({
      scriptId: "published-tool",
      name: "Hourly Sync",
      cronExpression: "0 */5 * * * *",
      input: {
        payload: { source: "file" },
        name: "Alice",
        count: 3
      },
      enabled: false
    });

    const updated = await runCli([
      "schedule",
      "update",
      "schedule-1",
      "--schedule-name",
      "Nightly Sync v2",
      "--count",
      "2",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(updated.status).toBe(0);
    expect(JSON.parse(updated.stdout)).toEqual(
      expect.objectContaining({
        id: "schedule-1",
        name: "Nightly Sync v2"
      })
    );

    const updateRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/schedules/schedule-1");
    expect(updateRequest?.body).toEqual({
      scriptId: "published-tool",
      name: "Nightly Sync v2",
      cronExpression: "0 0 * * * *",
      input: {
        name: "Alice",
        payload: { scope: "night" },
        count: 2
      },
      enabled: true
    });

    expect((await runCli(["schedule", "enable", "schedule-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["schedule", "disable", "schedule-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["schedule", "delete", "schedule-1", "--server", baseUrl, "--json"])).status).toBe(0);
  });

  it("invokes a plugin action with flat args and script input json", async () => {
    const result = await runCli([
      "plugin",
      "invoke",
      "plugin-a",
      "summarize",
      "--server",
      baseUrl,
      "--topic",
      "ops",
      "--retries",
      "2",
      "--args-json",
      '{"payload":{"scope":"night"}}',
      "--script-input-json",
      '{"locale":"zh-CN"}',
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        action: "summarize"
      })
    );

    const request = requests.find((item) => item.url === "/api/plugins/plugin-a/actions/summarize/invoke");
    expect(request?.body).toEqual({
      args: {
        payload: { scope: "night" },
        topic: "ops",
        retries: 2
      },
      scriptInput: {
        locale: "zh-CN"
      },
      responseView: "RESULT"
    });
  });

  it("lists plugins, references, and config", async () => {
    const list = await runCli(["plugin", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        pluginId: "plugin-a"
      })
    ]);

    const references = await runCli(["plugin", "references", "--server", baseUrl, "--json"]);
    expect(references.status).toBe(0);
    expect(JSON.parse(references.stdout)).toEqual([
      expect.objectContaining({
        pluginId: "plugin-a",
        sourceType: "SYSTEM"
      })
    ]);

    const detail = await runCli(["plugin", "get", "plugin-a", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        version: "1.2.3"
      })
    );

    const config = await runCli(["plugin", "config", "get", "plugin-a", "--server", baseUrl, "--json"]);
    expect(config.status).toBe(0);
    expect(JSON.parse(config.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        config: {
          endpoint: "http://service.internal"
        }
      })
    );
  });

  it("uploads a plugin jar through multipart install", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-plugin-"));
    const jarPath = path.join(tempDir, "plugin.jar");
    fs.writeFileSync(jarPath, Buffer.from("jar-content"));

    const result = await runCli([
      "plugin",
      "install",
      jarPath,
      "--server",
      baseUrl,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "uploaded-plugin"
      })
    );

    const request = requests.find((item) => item.url === "/api/plugins/install");
    expect(request?.headers["content-type"]).toContain("multipart/form-data; boundary=");
    expect(request?.bodyText).toContain('filename="plugin.jar"');
  });

  it("writes shared state through the cli", async () => {
    const result = await runCli([
      "state",
      "put",
      "oauth.github",
      "access-token",
      "--server",
      baseUrl,
      "--secret",
      "--expires-at",
      "2026-04-28T12:00:00",
      "--value-json",
      '{"accessToken":"gho_xxx"}',
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        namespace: "oauth.github",
        key: "access-token"
      })
    );

    const request = requests.find((item) => item.method === "PUT" && item.url === "/api/shared-state");
    expect(request?.body).toEqual({
      namespace: "oauth.github",
      key: "access-token",
      value: {
        accessToken: "gho_xxx"
      },
      secret: true,
      expiresAt: "2026-04-28T12:00:00"
    });
  });

  it("performs shared state compare-and-set", async () => {
    const result = await runCli([
      "state",
      "cas",
      "cursor.sync",
      "users",
      "--server",
      baseUrl,
      "--expected-version",
      "3",
      "--value-json",
      '{"cursor":"next-page-token"}',
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        updated: true
      })
    );

    const request = requests.find((item) => item.url === "/api/shared-state/cas");
    expect(request?.body).toEqual({
      namespace: "cursor.sync",
      key: "users",
      expectedVersion: 3,
      value: {
        cursor: "next-page-token"
      },
      expiresAt: null
    });
  });

  it("reads, lists, deletes, and purges shared state", async () => {
    const namespaces = await runCli(["state", "namespaces", "--server", baseUrl, "--json"]);
    expect(namespaces.status).toBe(0);
    expect(JSON.parse(namespaces.stdout)).toEqual(["oauth.github", "cursor.sync"]);

    const list = await runCli(["state", "list", "oauth.github", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        namespace: "oauth.github",
        key: "access-token"
      })
    ]);

    const detail = await runCli(["state", "get", "oauth.github", "access-token", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        namespace: "oauth.github",
        key: "access-token",
        value: {
          accessToken: "gho_xxx"
        }
      })
    );

    expect((await runCli(["state", "delete", "oauth.github", "access-token", "--server", baseUrl, "--json"])).status).toBe(0);

    const purge = await runCli(["state", "purge-expired", "oauth.github", "--server", baseUrl, "--json"]);
    expect(purge.status).toBe(0);
    expect(JSON.parse(purge.stdout)).toEqual({
      purged: 2,
      namespace: "oauth.github"
    });
  });

  it("persists config values", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-home-"));
    expect((await runCli(["config", "set", "server", baseUrl], home)).status).toBe(0);
    const show = await runCli(["config", "show", "--json"], home);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout)).toEqual(
      expect.objectContaining({
        serverUrl: baseUrl,
        tokenConfigured: false
      })
    );
  });
});

async function runCli(args: string[], homeDir?: string): Promise<{
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", ["./bin/dev.js", ...args], {
      cwd: cliDir,
      env: {
        ...process.env,
        HOME: homeDir ?? process.env.HOME,
        XDG_CONFIG_HOME: homeDir ? path.join(homeDir, ".config-root") : process.env.XDG_CONFIG_HOME,
        NODE_OPTIONS: "--import tsx"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`CLI timed out: ${args.join(" ")}`));
    }, 10000);

    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function json(response: http.ServerResponse, payload: unknown): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
