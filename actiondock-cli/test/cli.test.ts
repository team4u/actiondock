import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliDir = path.resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf8")).version as string;

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

    if (req.method === "GET" && req.url === "/api/event-sources") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "source-1",
            key: "github.issue",
            name: "GitHub Issue",
            enabled: true,
            transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/event-sources/source-1/events" },
            auth: { mode: "HMAC_SHA256" },
            normalizationProcessor: { mode: "JSON_PATH" }
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-sources/source-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "source-1",
          key: "github.issue",
          name: "GitHub Issue",
          description: "GitHub webhook source",
          enabled: true,
          transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/event-sources/source-1/events" },
          auth: { mode: "HMAC_SHA256", signatureHeader: "X-Hub-Signature-256" },
          normalizationProcessor: { mode: "JSON_PATH", jsonPath: { fields: { eventType: "$.headers.X-GitHub-Event" } } },
          sampleContext: { body: { action: "opened" } },
          lastReceivedAt: "2026-04-29T00:00:00"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/event-sources") {
      return json(res, {
        status: 0,
        msg: "created",
        data: body
      });
    }

    if (req.method === "PUT" && req.url === "/api/event-sources/source-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: body
      });
    }

    if (req.method === "POST" && req.url === "/api/event-sources/source-1/enable") {
      return json(res, {
        status: 0,
        msg: "enabled",
        data: {
          id: "source-1",
          key: "github.issue",
          name: "GitHub Issue",
          enabled: true,
          transport: { type: "HTTP_WEBHOOK" }
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/event-sources/source-1/disable") {
      return json(res, {
        status: 0,
        msg: "disabled",
        data: {
          id: "source-1",
          key: "github.issue",
          name: "GitHub Issue",
          enabled: false,
          transport: { type: "HTTP_WEBHOOK" }
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/event-sources/source-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/event-sources/source-1/test-normalization") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "normalized-1",
          sourceId: "source-1",
          sourceKey: "github.issue",
          eventType: "issues",
          eventId: "delivery-1",
          actor: "octocat",
          subject: "Login failed",
          headers: body?.headers ?? {},
          query: body?.query ?? {},
          body: body?.body ?? {},
          receivedAt: "2026-04-29T00:00:00"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/event-sources/source-1/events") {
      return json(res, {
        status: 0,
        msg: "accepted",
        data: {
          event: {
            id: "event-1",
            sourceId: "source-1",
            sourceKey: "github.issue",
            status: "DISPATCHED",
            eventType: "issues",
            eventId: "delivery-1",
            actor: "octocat",
            subject: "Login failed",
            rawHeaders: body?.headers ?? {},
            rawQuery: body?.query ?? {},
            rawBody: body?.body ?? {},
            normalizedEvent: {
              id: "normalized-1",
              sourceId: "source-1",
              sourceKey: "github.issue",
              eventType: "issues",
              eventId: "delivery-1",
              actor: "octocat",
              subject: "Login failed",
              headers: body?.headers ?? {},
              query: body?.query ?? {},
              body: body?.body ?? {}
            }
          },
          dispatches: [
            {
              id: "dispatch-1",
              eventId: "event-1",
              sourceId: "source-1",
              triggerId: "trigger-1",
              targetScriptId: "published-tool",
              status: "EXECUTION_CREATED",
              filterMatched: true,
              idempotencyKey: "delivery-1",
              mappedInput: { name: "Alice" },
              executionId: "exec-event-1",
              executionStatus: "SUCCESS"
            }
          ]
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/event-sources/source-1/events?limit=5") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "event-1",
            sourceId: "source-1",
            sourceKey: "github.issue",
            status: "DISPATCHED",
            eventType: "issues",
            eventId: "delivery-1"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-triggers") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "trigger-1",
            name: "Issue classifier",
            enabled: true,
            sourceId: "source-1",
            targetScriptId: "published-tool",
            submitMode: "ASYNC",
            responseView: "RESULT"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-triggers/trigger-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "trigger-1",
          name: "Issue classifier",
          description: "Classify incoming GitHub issues",
          enabled: true,
          sourceId: "source-1",
          targetScriptId: "published-tool",
          filterProcessor: { mode: "JSON_PATH" },
          idempotencyProcessor: { mode: "JSON_PATH" },
          inputProcessor: { mode: "SCRIPT_REF" },
          submitMode: "ASYNC",
          responseView: "RESULT",
          lastEventId: "event-1",
          lastExecutionId: "exec-event-1",
          lastExecutionStatus: "SUCCESS"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/event-triggers") {
      return json(res, {
        status: 0,
        msg: "created",
        data: body
      });
    }

    if (req.method === "PUT" && req.url === "/api/event-triggers/trigger-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: body
      });
    }

    if (req.method === "POST" && req.url === "/api/event-triggers/trigger-1/enable") {
      return json(res, {
        status: 0,
        msg: "enabled",
        data: {
          id: "trigger-1",
          name: "Issue classifier",
          enabled: true,
          sourceId: "source-1",
          targetScriptId: "published-tool"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/event-triggers/trigger-1/disable") {
      return json(res, {
        status: 0,
        msg: "disabled",
        data: {
          id: "trigger-1",
          name: "Issue classifier",
          enabled: false,
          sourceId: "source-1",
          targetScriptId: "published-tool"
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/event-triggers/trigger-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/event-triggers/trigger-1/test") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          event: body?.event,
          filterMatched: true,
          filterResult: {
            success: true,
            output: { matched: true },
            schemaValid: true,
            logs: [],
            durationMs: 2
          },
          idempotencyResult: {
            success: true,
            output: { key: "delivery-1" },
            schemaValid: true,
            logs: [],
            durationMs: 1
          },
          idempotencyKey: "delivery-1",
          inputResult: {
            success: true,
            output: { name: "Alice" },
            schemaValid: true,
            logs: [],
            durationMs: 5
          },
          mappedInput: { name: "Alice" },
          schemaValid: true,
          fieldErrors: [],
          execution: body?.execute
            ? {
                id: "exec-event-1",
                scriptId: "published-tool",
                status: "SUCCESS",
                submitMode: "ASYNC",
                triggerSource: "EVENT",
                eventSourceId: "source-1",
                eventTriggerId: "trigger-1",
                eventRecordId: "event-1",
                eventDispatchId: "dispatch-1"
              }
            : null
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/event-triggers/trigger-1/dispatches") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "dispatch-1",
            eventId: "event-1",
            sourceId: "source-1",
            triggerId: "trigger-1",
            targetScriptId: "published-tool",
            status: "EXECUTION_CREATED",
            executionId: "exec-event-1"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-records") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "event-1",
            sourceId: "source-1",
            sourceKey: "github.issue",
            status: "DISPATCHED",
            eventType: "issues"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-records?sourceId=source-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "event-1",
            sourceId: "source-1",
            sourceKey: "github.issue",
            status: "DISPATCHED",
            eventType: "issues"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/event-records/event-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "event-1",
          sourceId: "source-1",
          sourceKey: "github.issue",
          status: "DISPATCHED",
          eventType: "issues",
          eventId: "delivery-1",
          actor: "octocat",
          subject: "Login failed",
          rawHeaders: { "X-GitHub-Event": "issues" },
          rawQuery: {},
          rawBody: { action: "opened" },
          normalizedEvent: {
            id: "normalized-1",
            sourceId: "source-1",
            sourceKey: "github.issue",
            eventType: "issues",
            eventId: "delivery-1"
          }
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/event-records/event-1/dispatches") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "dispatch-1",
            eventId: "event-1",
            sourceId: "source-1",
            triggerId: "trigger-1",
            targetScriptId: "published-tool",
            status: "EXECUTION_CREATED",
            executionId: "exec-event-1"
          }
        ]
      });
    }

    if (req.method === "POST" && req.url === "/api/processors/test") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          success: true,
          output: { title: "Login failed" },
          errorMessage: null,
          logs: [],
          durationMs: 4,
          schemaValid: true,
          fieldErrors: []
        }
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
  it("lists published scripts by default", async () => {
    const result = await runCli(["script", "list", "--server", baseUrl]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("published-tool");
    expect(result.stdout).not.toContain("draft-only-tool");
  });

  it("returns schema detail as JSON", async () => {
    const result = await runCli(["script", "schema", "published-tool", "--server", baseUrl, "--json"]);
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

  it("runs a published script with flat flags and merged JSON input", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-test-"));
    const inputFile = path.join(tempDir, "input.json");
    fs.writeFileSync(inputFile, JSON.stringify({ payload: { source: "file" } }));

    const result = await runCli([
      "script",
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

  it("reads script detail for draft with json output", async () => {
    const result = await runCli(["script", "get", "published-tool", "--draft", "--server", baseUrl, "--json"]);
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
  }, 20_000);

  it("manages event sources through cli", async () => {
    const list = await runCli(["event-source", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "source-1",
        key: "github.issue"
      })
    ]);

    const detail = await runCli(["event-source", "get", "source-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "source-1",
        auth: expect.objectContaining({
          mode: "HMAC_SHA256"
        })
      })
    );

    const createDefinition = {
      id: "source-2",
      key: "custom.crm",
      name: "Custom CRM",
      transport: { type: "HTTP_WEBHOOK" },
      auth: { mode: "HEADER_TOKEN", tokenHeader: "X-Token" },
      normalizationProcessor: { mode: "JSON_PATH", jsonPath: { fields: { eventType: "$.body.type" } } }
    };
    const created = await runCli([
      "event-source",
      "create",
      "--definition-json",
      JSON.stringify(createDefinition),
      "--name",
      "Custom CRM Source",
      "--disabled",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(created.status).toBe(0);
    expect(JSON.parse(created.stdout)).toEqual(
      expect.objectContaining({
        id: "source-2",
        name: "Custom CRM Source",
        enabled: false
      })
    );

    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/event-sources");
    expect(createRequest?.body).toEqual({
      id: "source-2",
      key: "custom.crm",
      name: "Custom CRM Source",
      transport: { type: "HTTP_WEBHOOK" },
      auth: { mode: "HEADER_TOKEN", tokenHeader: "X-Token" },
      normalizationProcessor: { mode: "JSON_PATH", jsonPath: { fields: { eventType: "$.body.type" } } },
      enabled: false
    });

    const updated = await runCli([
      "event-source",
      "update",
      "source-1",
      "--definition-json",
      '{"auth":{"secretConfigKey":"github.secret"}}',
      "--description",
      "Updated source",
      "--transport-type",
      "http_webhook",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(updated.status).toBe(0);
    expect(JSON.parse(updated.stdout)).toEqual(
      expect.objectContaining({
        id: "source-1",
        description: "Updated source"
      })
    );

    const updateRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/event-sources/source-1");
    expect(updateRequest?.body).toEqual({
      id: "source-1",
      key: "github.issue",
      name: "GitHub Issue",
      description: "Updated source",
      enabled: true,
      transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/event-sources/source-1/events" },
      auth: {
        mode: "HMAC_SHA256",
        signatureHeader: "X-Hub-Signature-256",
        secretConfigKey: "github.secret"
      },
      normalizationProcessor: { mode: "JSON_PATH", jsonPath: { fields: { eventType: "$.headers.X-GitHub-Event" } } },
      sampleContext: { body: { action: "opened" } },
      lastReceivedAt: "2026-04-29T00:00:00"
    });

    expect((await runCli(["event-source", "enable", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["event-source", "disable", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const normalized = await runCli([
      "event-source",
      "test-normalization",
      "source-1",
      "--payload-json",
      '{"headers":{"X-GitHub-Event":"issues"},"body":{"action":"opened","sender":{"login":"octocat"}}}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(normalized.status).toBe(0);
    expect(JSON.parse(normalized.stdout)).toEqual(
      expect.objectContaining({
        sourceId: "source-1",
        eventType: "issues"
      })
    );

    const ingested = await runCli([
      "event-source",
      "ingest",
      "source-1",
      "--payload-json",
      '{"headers":{"X-GitHub-Event":"issues"},"body":{"action":"opened"}}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(ingested.status).toBe(0);
    expect(JSON.parse(ingested.stdout)).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          id: "event-1"
        })
      })
    );

    const events = await runCli([
      "event-source",
      "events",
      "source-1",
      "--limit",
      "5",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(events.status).toBe(0);
    expect(JSON.parse(events.stdout)).toEqual([
      expect.objectContaining({
        id: "event-1"
      })
    ]);

    expect((await runCli(["event-source", "delete", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);
  }, 15000);

  it("manages event triggers and processor tests through cli", async () => {
    const list = await runCli(["event-trigger", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "trigger-1",
        sourceId: "source-1"
      })
    ]);

    const detail = await runCli(["event-trigger", "get", "trigger-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "trigger-1",
        inputProcessor: expect.objectContaining({
          mode: "SCRIPT_REF"
        })
      })
    );

    const createDefinition = {
      id: "trigger-2",
      name: "CRM trigger",
      sourceId: "source-1",
      targetScriptId: "published-tool",
      inputProcessor: {
        mode: "SCRIPT_REF",
        scriptRef: {
          scriptId: "processor-script",
          versionMode: "PUBLISHED"
        }
      }
    };
    const created = await runCli([
      "event-trigger",
      "create",
      "--definition-json",
      JSON.stringify(createDefinition),
      "--submit-mode",
      "sync",
      "--response-view",
      "debug",
      "--disabled",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(created.status).toBe(0);
    expect(JSON.parse(created.stdout)).toEqual(
      expect.objectContaining({
        id: "trigger-2",
        submitMode: "SYNC",
        responseView: "DEBUG",
        enabled: false
      })
    );

    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/event-triggers");
    expect(createRequest?.body).toEqual({
      id: "trigger-2",
      name: "CRM trigger",
      sourceId: "source-1",
      targetScriptId: "published-tool",
      inputProcessor: {
        mode: "SCRIPT_REF",
        scriptRef: {
          scriptId: "processor-script",
          versionMode: "PUBLISHED"
        }
      },
      submitMode: "SYNC",
      responseView: "DEBUG",
      enabled: false
    });

    const updated = await runCli([
      "event-trigger",
      "update",
      "trigger-1",
      "--definition-json",
      '{"inputProcessor":{"scriptRef":{"versionMode":"PUBLISHED"}}}',
      "--name",
      "Issue classifier v2",
      "--submit-mode",
      "sync",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(updated.status).toBe(0);
    expect(JSON.parse(updated.stdout)).toEqual(
      expect.objectContaining({
        id: "trigger-1",
        name: "Issue classifier v2",
        submitMode: "SYNC"
      })
    );

    const updateRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/event-triggers/trigger-1");
    expect(updateRequest?.body).toEqual({
      id: "trigger-1",
      name: "Issue classifier v2",
      description: "Classify incoming GitHub issues",
      enabled: true,
      sourceId: "source-1",
      targetScriptId: "published-tool",
      filterProcessor: { mode: "JSON_PATH" },
      idempotencyProcessor: { mode: "JSON_PATH" },
      inputProcessor: { mode: "SCRIPT_REF", scriptRef: { versionMode: "PUBLISHED" } },
      submitMode: "SYNC",
      responseView: "RESULT",
      lastEventId: "event-1",
      lastExecutionId: "exec-event-1",
      lastExecutionStatus: "SUCCESS"
    });

    expect((await runCli(["event-trigger", "enable", "trigger-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["event-trigger", "disable", "trigger-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const tested = await runCli([
      "event-trigger",
      "test",
      "trigger-1",
      "--event-json",
      '{"sourceId":"source-1","sourceKey":"github.issue","eventType":"issues","eventId":"delivery-1","body":{"action":"opened"}}',
      "--execute",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(tested.status).toBe(0);
    expect(JSON.parse(tested.stdout)).toEqual(
      expect.objectContaining({
        filterMatched: true,
        execution: expect.objectContaining({
          triggerSource: "EVENT"
        })
      })
    );

    const dispatches = await runCli(["event-trigger", "dispatches", "trigger-1", "--server", baseUrl, "--json"]);
    expect(dispatches.status).toBe(0);
    expect(JSON.parse(dispatches.stdout)).toEqual([
      expect.objectContaining({
        id: "dispatch-1"
      })
    ]);

    expect((await runCli(["event-trigger", "delete", "trigger-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const processor = await runCli([
      "processor",
      "test",
      "--processor-json",
      '{"mode":"JSON_PATH","jsonPath":{"fields":{"title":"$.body.issue.title"}}}',
      "--context-json",
      '{"body":{"issue":{"title":"Login failed"}}}',
      "--expected-output-schema-json",
      '{"type":"object","properties":{"title":{"type":"string"}}}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(processor.status).toBe(0);
    expect(JSON.parse(processor.stdout)).toEqual(
      expect.objectContaining({
        success: true,
        schemaValid: true
      })
    );
  }, 15000);

  it("lists and inspects event records through cli", async () => {
    const list = await runCli(["event-record", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "event-1"
      })
    ]);

    const filtered = await runCli(["event-record", "list", "--source-id", "source-1", "--server", baseUrl, "--json"]);
    expect(filtered.status).toBe(0);
    expect(JSON.parse(filtered.stdout)).toEqual([
      expect.objectContaining({
        sourceId: "source-1"
      })
    ]);

    const detail = await runCli(["event-record", "get", "event-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "event-1",
        normalizedEvent: expect.objectContaining({
          id: "normalized-1"
        })
      })
    );

    const dispatches = await runCli(["event-record", "dispatches", "event-1", "--server", baseUrl, "--json"]);
    expect(dispatches.status).toBe(0);
    expect(JSON.parse(dispatches.stdout)).toEqual([
      expect.objectContaining({
        id: "dispatch-1"
      })
    ]);
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

  it("shows the self-update command in dry-run mode", async () => {
    const result = await runCli(["self-update", "--dry-run", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      packageName: "actiondock",
      currentVersion: packageVersion,
      target: "latest",
      command: "npm install -g actiondock@latest",
      executable: "npm",
      args: ["install", "-g", "actiondock@latest"],
      dryRun: true,
    });
  });

  it("supports self-update to a specific version in dry-run mode", async () => {
    const result = await runCli(["self-update", "0.1.4", "--dry-run", "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        target: "0.1.4",
        command: "npm install -g actiondock@0.1.4",
      }),
    );
  });

  it("keeps command output stable when version checks are disabled explicitly", async () => {
    const result = await runCli(
      ["script", "list", "--server", baseUrl, "--json"],
      undefined,
      { ACTIONDOCK_SKIP_NEW_VERSION_CHECK: "1" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      {
        id: "published-tool",
        name: "Published Tool",
        type: "GROOVY",
        published: true
      }
    ]);
  });
});

async function runCli(args: string[], homeDir?: string, envOverrides?: NodeJS.ProcessEnv): Promise<{
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
        ...envOverrides,
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
