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

    if (req.method === "DELETE" && req.url === "/api/scripts/published-tool") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/fork") {
      return json(res, {
        status: 0,
        msg: "forked",
        data: {
          id: body?.id,
          name: body?.name,
          type: "GROOVY",
          status: "DRAFT",
          version: 1,
          publishedSnapshot: null
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/development-status") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          scriptId: "published-tool",
          repositoryId: "repo-1",
          repositoryToolId: "tool-1",
          repositoryVersion: "1.0.0",
          dirty: false,
          remoteChanged: true,
          syncState: "REMOTE_CHANGES",
          remoteVersion: "1.0.1",
          sourceSyncedAt: "2026-05-01T00:00:00"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/development-pull?force=true") {
      return json(res, {
        status: 0,
        msg: "pulled",
        data: {
          id: "published-tool",
          name: "Published Tool",
          type: "GROOVY",
          status: "DRAFT",
          version: 8,
          repositoryId: "repo-1",
          repositoryToolId: "tool-1",
          repositoryVersion: "1.0.1",
          publishedSnapshot: null
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/execute") {
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

    if (req.method === "PUT" && req.url === "/api/plugins/plugin-a/config") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          pluginId: "plugin-a",
          config: body?.config ?? {}
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

    if (req.method === "POST" && req.url === "/api/plugins/plugin-a/upgrade") {
      return json(res, {
        status: 0,
        msg: "upgraded",
        data: {
          pluginId: "plugin-a",
          version: "1.2.4",
          actions: []
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/plugins/plugin-a/start") {
      return json(res, {
        status: 0,
        msg: "started",
        data: {
          pluginId: "plugin-a",
          version: "1.2.3",
          started: true,
          actions: []
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/plugins/plugin-a/stop") {
      return json(res, {
        status: 0,
        msg: "stopped",
        data: {
          pluginId: "plugin-a",
          version: "1.2.3",
          started: false,
          actions: []
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/plugins/plugin-a?force=true") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins/plugin-a/download") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/java-archive");
      res.setHeader("content-disposition", 'attachment; filename="plugin-a.jar"');
      res.end("jar-content");
      return;
    }

    if (req.method === "GET" && req.url === "/api/config-values") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            key: "github.token",
            valueMasked: "********",
            hasValue: true,
            secret: true,
            managed: false,
            overridden: false
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/config-values/github.token") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          key: "github.token",
          valueMasked: "********",
          hasValue: true,
          secret: true,
          managed: false,
          overridden: false,
          impactedScripts: []
        }
      });
    }

    if (req.method === "PUT" && req.url === "/api/config-values/github.token") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          key: "github.token",
          value: body?.secret ? null : body?.value,
          valueMasked: body?.secret ? "********" : null,
          hasValue: Boolean(body?.value),
          description: body?.description,
          secret: body?.secret ?? false,
          managed: false,
          overridden: false
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/config-values/github.token/copy-local-override") {
      return json(res, {
        status: 0,
        msg: "copied",
        data: {
          key: "github.token",
          valueMasked: "********",
          hasValue: true,
          secret: true,
          overridden: true,
          impactedScripts: []
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/config-values/github.token/restore-repository-default") {
      return json(res, {
        status: 0,
        msg: "restored",
        data: {
          key: "github.token",
          valueMasked: "********",
          hasValue: true,
          secret: true,
          managed: true,
          overridden: false,
          impactedScripts: []
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/config-values/github.token") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/access-tokens") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "token-1",
            name: "CI",
            tokenPreview: "ad_****",
            enabled: true
          }
        ]
      });
    }

    if (req.method === "POST" && req.url === "/api/access-tokens") {
      return json(res, {
        status: 0,
        msg: "created",
        data: {
          id: "token-2",
          name: body?.name,
          tokenPreview: "ad_new****",
          enabled: true,
          tokenValue: "ad_secret_token"
        }
      });
    }

    if (req.method === "PUT" && req.url === "/api/access-tokens/token-1") {
      return json(res, {
        status: 0,
        msg: "renamed",
        data: {
          id: "token-1",
          name: body?.name,
          tokenPreview: "ad_****",
          enabled: true
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/access-tokens/token-1/enable") {
      return json(res, {
        status: 0,
        msg: "enabled",
        data: {
          id: "token-1",
          name: "CI",
          enabled: true
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/access-tokens/token-1/disable") {
      return json(res, {
        status: 0,
        msg: "disabled",
        data: {
          id: "token-1",
          name: "CI",
          enabled: false
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/access-tokens/token-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/repositories") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "repo-1",
            name: "Repo 1",
            type: "LOCAL_DIR",
            url: "/tmp/repo",
            enabled: true,
            trustLevel: "TRUSTED",
            usage: "DEVELOPMENT"
          }
        ]
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories") {
      return json(res, {
        status: 0,
        msg: "created",
        data: body
      });
    }

    if (req.method === "PUT" && req.url === "/api/repositories/repo-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: body
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/sync") {
      return json(res, {
        status: 0,
        msg: "synced",
        data: {
          id: "repo-1",
          name: "Repo 1",
          type: "LOCAL_DIR",
          url: "/tmp/repo",
          enabled: true,
          trustLevel: "TRUSTED",
          usage: "DEVELOPMENT",
          lastSyncedAt: "2026-05-01T00:00:00"
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/repositories/repo-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/repositories/tools") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            repositoryId: "repo-1",
            toolId: "tool-1",
            installedScriptId: "published-tool",
            displayName: "Tool 1",
            version: "1.0.0",
            tags: [],
            type: "GROOVY",
            scriptDependencies: [],
            pluginDependencies: [],
            installed: true,
            installedVersion: "1.0.0",
            updateAvailable: false,
            trusted: true
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/repositories/repo-1/tools/tool-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          descriptor: {
            repositoryId: "repo-1",
            toolId: "tool-1",
            installedScriptId: "published-tool",
            displayName: "Tool 1",
            version: "1.0.0",
            tags: [],
            type: "GROOVY",
            scriptDependencies: [],
            pluginDependencies: [],
            installed: true,
            installedVersion: "1.0.0",
            updateAvailable: false,
            trusted: true
          },
          source: "return input",
          configTemplate: [],
          scheduleTemplate: []
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/tools/tool-1/install") {
      return json(res, {
        status: 0,
        msg: "installed",
        data: {
          scriptId: "tool-1",
          repositoryId: "repo-1",
          toolId: "tool-1",
          name: "Tool 1",
          version: "1.0.0"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/tools/tool-1/update") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          scriptId: "tool-1",
          repositoryId: "repo-1",
          toolId: "tool-1",
          name: "Tool 1",
          version: "1.0.1"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/tools/tool-1/develop") {
      return json(res, {
        status: 0,
        msg: "developed",
        data: {
          id: body?.scriptId ?? "tool-1-dev",
          name: "Tool 1",
          type: "GROOVY",
          status: "DRAFT",
          publishedSnapshot: null
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/installed-tools/published-tool") {
      return json(res, {
        status: 0,
        msg: "uninstalled",
        data: null
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/presets") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "preset-1",
            scriptId: "published-tool",
            name: "Night input",
            input: { name: "Alice" },
            managed: false,
            editable: true
          }
        ]
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/presets") {
      return json(res, {
        status: 0,
        msg: "created",
        data: {
          id: "preset-2",
          scriptId: "published-tool",
          name: body?.name,
          input: body?.input,
          managed: false,
          editable: true
        }
      });
    }

    if (req.method === "PUT" && req.url === "/api/scripts/published-tool/presets/preset-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          id: "preset-1",
          scriptId: "published-tool",
          name: body?.name,
          input: body?.input,
          managed: false,
          editable: true
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/scripts/published-tool/presets/preset-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
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
  await closeServer(server);
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

    const executionRequest = requests.find((item) => item.url === "/api/scripts/published-tool/execute");
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

  it("manages script lifecycle gaps", async () => {
    const fork = await runCli([
      "script",
      "fork",
      "published-tool",
      "--script-id",
      "forked-tool",
      "--name",
      "Forked Tool",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(fork.status).toBe(0);
    expect(JSON.parse(fork.stdout)).toEqual(
      expect.objectContaining({
        id: "forked-tool",
        name: "Forked Tool"
      })
    );
    const forkRequest = requests.find((item) => item.method === "POST" && item.url === "/api/scripts/published-tool/fork");
    expect(forkRequest?.body).toEqual({
      id: "forked-tool",
      name: "Forked Tool"
    });

    const status = await runCli(["script", "development-status", "published-tool", "--server", baseUrl, "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(
      expect.objectContaining({
        scriptId: "published-tool",
        syncState: "REMOTE_CHANGES"
      })
    );

    const pull = await runCli(["script", "development-pull", "published-tool", "--force", "--server", baseUrl, "--json"]);
    expect(pull.status).toBe(0);
    expect(JSON.parse(pull.stdout)).toEqual(
      expect.objectContaining({
        id: "published-tool",
        repositoryVersion: "1.0.1"
      })
    );
    expect(requests.some((item) => item.method === "POST" && item.url === "/api/scripts/published-tool/development-pull?force=true")).toBe(true);

    const deleted = await runCli(["script", "delete", "published-tool", "--server", baseUrl, "--json"]);
    expect(deleted.status).toBe(0);
    expect(JSON.parse(deleted.stdout)).toEqual({
      deleted: true,
      id: "published-tool"
    });
  }, 20_000);

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

  it("manages plugin lifecycle, config, downloads, and upgrades", async () => {
    const config = await runCli([
      "plugin",
      "config",
      "set",
      "plugin-a",
      "--server",
      baseUrl,
      "--config-json",
      '{"endpoint":"http://new-service"}',
      "--json"
    ]);
    expect(config.status).toBe(0);
    expect(JSON.parse(config.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        config: { endpoint: "http://new-service" }
      })
    );

    const configRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/plugins/plugin-a/config");
    expect(configRequest?.body).toEqual({
      config: { endpoint: "http://new-service" }
    });

    expect((await runCli(["plugin", "start", "plugin-a", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["plugin", "stop", "plugin-a", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["plugin", "uninstall", "plugin-a", "--force", "--server", baseUrl, "--json"])).status).toBe(0);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-plugin-download-"));
    const download = await runCli(["plugin", "download", "plugin-a", "--output", tempDir, "--server", baseUrl, "--json"]);
    expect(download.status).toBe(0);
    const downloaded = JSON.parse(download.stdout);
    expect(fs.readFileSync(downloaded.output, "utf8")).toBe("jar-content");

    const jarPath = path.join(tempDir, "plugin-upgrade.jar");
    fs.writeFileSync(jarPath, Buffer.from("jar-content"));
    const upgrade = await runCli(["plugin", "upgrade", "plugin-a", jarPath, "--server", baseUrl, "--json"]);
    expect(upgrade.status).toBe(0);
    expect(JSON.parse(upgrade.stdout)).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        version: "1.2.4"
      })
    );
    const upgradeRequest = requests.find((item) => item.url === "/api/plugins/plugin-a/upgrade");
    expect(upgradeRequest?.headers["content-type"]).toContain("multipart/form-data; boundary=");
  }, 20_000);

  it("manages config values", async () => {
    const list = await runCli(["config-value", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        key: "github.token",
        valueMasked: "********"
      })
    ]);

    const detail = await runCli(["config-value", "get", "github.token", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        key: "github.token",
        valueMasked: "********"
      })
    );

    const set = await runCli([
      "config-value",
      "set",
      "github.token",
      "--value",
      "gho_xxx",
      "--description",
      "GitHub token",
      "--secret",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(set.status).toBe(0);
    const setRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/config-values/github.token");
    expect(setRequest?.body).toEqual({
      key: "github.token",
      value: "gho_xxx",
      description: "GitHub token",
      secret: true,
    });

    expect((await runCli(["config-value", "copy-local-override", "github.token", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["config-value", "restore-repository-default", "github.token", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["config-value", "delete", "github.token", "--server", baseUrl, "--json"])).status).toBe(0);
  }, 20_000);

  it("manages access tokens", async () => {
    const list = await runCli(["access-token", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "token-1",
        tokenPreview: "ad_****"
      })
    ]);

    const create = await runCli(["access-token", "create", "--name", "Deploy", "--server", baseUrl]);
    expect(create.status).toBe(0);
    expect(create.stdout).toContain("ad_secret_token");

    const createJson = await runCli(["access-token", "create", "--name", "Deploy", "--server", baseUrl, "--json"]);
    expect(createJson.status).toBe(0);
    expect(JSON.parse(createJson.stdout)).toEqual(
      expect.objectContaining({
        id: "token-2",
        tokenValue: "ad_secret_token"
      })
    );

    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/access-tokens");
    expect(createRequest?.body).toEqual({ name: "Deploy" });

    expect((await runCli(["access-token", "rename", "token-1", "--name", "CI renamed", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["access-token", "enable", "token-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["access-token", "disable", "token-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["access-token", "delete", "token-1", "--server", baseUrl, "--json"])).status).toBe(0);
  }, 20_000);

  it("manages repositories and repository tools", async () => {
    const list = await runCli(["repository", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "repo-1",
        type: "LOCAL_DIR"
      })
    ]);

    const created = await runCli([
      "repository",
      "create",
      "--repository-id",
      "repo-2",
      "--name",
      "Repo 2",
      "--type",
      "local-dir",
      "--url",
      "/tmp/repo2",
      "--usage",
      "development",
      "--trust-level",
      "trusted",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(created.status).toBe(0);
    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/repositories");
    expect(createRequest?.body).toEqual({
      id: "repo-2",
      name: "Repo 2",
      type: "LOCAL_DIR",
      url: "/tmp/repo2",
      usage: "DEVELOPMENT",
      trustLevel: "TRUSTED",
      enabled: true
    });

    expect((await runCli(["repository", "sync", "repo-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["repository", "delete", "repo-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const toolList = await runCli(["repository", "tool", "list", "--server", baseUrl, "--json"]);
    expect(toolList.status).toBe(0);
    expect(JSON.parse(toolList.stdout)).toEqual([
      expect.objectContaining({
        repositoryId: "repo-1",
        toolId: "tool-1"
      })
    ]);

    const toolDetail = await runCli(["repository", "tool", "get", "repo-1", "tool-1", "--server", baseUrl, "--json"]);
    expect(toolDetail.status).toBe(0);
    expect(JSON.parse(toolDetail.stdout)).toEqual(
      expect.objectContaining({
        descriptor: expect.objectContaining({ toolId: "tool-1" })
      })
    );

    const install = await runCli([
      "repository",
      "tool",
      "install",
      "repo-1",
      "tool-1",
      "--install-schedules",
      "--install-plugin-dependencies",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(install.status).toBe(0);
    const installRequest = requests.find((item) => item.method === "POST" && item.url === "/api/repositories/repo-1/tools/tool-1/install");
    expect(installRequest?.body).toEqual({
      installSchedules: true,
      installScriptDependencies: false,
      installPluginDependencies: true,
      forcePluginUpgrade: false
    });

    expect((await runCli(["repository", "tool", "update", "repo-1", "tool-1", "--server", baseUrl, "--json"])).status).toBe(0);
    const develop = await runCli(["repository", "tool", "develop", "repo-1", "tool-1", "--script-id", "tool-dev", "--server", baseUrl, "--json"]);
    expect(develop.status).toBe(0);
    expect(JSON.parse(develop.stdout)).toEqual(
      expect.objectContaining({
        id: "tool-dev"
      })
    );

    const uninstall = await runCli(["repository", "tool", "uninstall", "published-tool", "--server", baseUrl, "--json"]);
    expect(uninstall.status).toBe(0);
    expect(JSON.parse(uninstall.stdout)).toEqual({
      uninstalled: true,
      scriptId: "published-tool"
    });
    expect(requests.some((item) => item.method === "DELETE" && item.url === "/api/installed-tools/published-tool")).toBe(true);
  }, 20_000);

  it("manages script execution presets", async () => {
    const list = await runCli(["script", "preset", "list", "published-tool", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "preset-1",
        scriptId: "published-tool"
      })
    ]);

    const create = await runCli([
      "script",
      "preset",
      "create",
      "published-tool",
      "--name",
      "Day input",
      "--input-json",
      '{"name":"Bob"}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(create.status).toBe(0);
    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/scripts/published-tool/presets");
    expect(createRequest?.body).toEqual({
      name: "Day input",
      input: { name: "Bob" }
    });

    const update = await runCli([
      "script",
      "preset",
      "update",
      "published-tool",
      "preset-1",
      "--name",
      "Night input v2",
      "--input-json",
      '{"name":"Alice","count":2}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(update.status).toBe(0);
    const updateRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/scripts/published-tool/presets/preset-1");
    expect(updateRequest?.body).toEqual({
      name: "Night input v2",
      input: { name: "Alice", count: 2 }
    });

    expect((await runCli(["script", "preset", "delete", "published-tool", "preset-1", "--server", baseUrl, "--json"])).status).toBe(0);
  }, 20_000);

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

  it("persists and uses server profiles", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-home-"));
    expect((await runCli(["config", "add", "local", "--server", baseUrl, "--token", "profile-token"], home)).status).toBe(0);
    const show = await runCli(["config", "show", "--json"], home);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout)).toEqual(
      expect.objectContaining({
        currentProfile: "local",
        profile: "local",
        serverUrl: baseUrl,
        tokenConfigured: true
      })
    );

    requests.length = 0;
    const list = await runCli(["script", "list", "--json"], home);
    expect(list.status).toBe(0);
    expect(requests.at(-1)?.url).toBe("/api/scripts");
    expect(requests.at(-1)?.headers.authorization).toBe("Bearer profile-token");
  });

  it("uses profiles for script run without treating profile as script input", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-home-"));
    expect((await runCli(["config", "add", "local", "--server", baseUrl, "--token", "profile-token"], home)).status).toBe(0);

    requests.length = 0;
    const result = await runCli([
      "script",
      "run",
      "published-tool",
      "--profile",
      "local",
      "--name",
      "Alice",
      "--json"
    ], home);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        id: "exec-1",
        status: "SUCCESS"
      })
    );

    const executionRequest = requests.find((item) => item.url === "/api/scripts/published-tool/execute");
    expect(executionRequest?.headers.authorization).toBe("Bearer profile-token");
    expect(executionRequest?.body).toEqual({
      input: {
        name: "Alice"
      },
      mode: "SYNC",
      responseView: "RESULT"
    });
  });

  it("switches profiles and supports explicit overrides", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-home-"));
    const otherServer = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url ?? "", headers: req.headers });
      json(res, { status: 0, msg: "ok", data: [] });
    });
    const otherUrl = await listen(otherServer);

    try {
      expect((await runCli(["config", "add", "local", "--server", baseUrl], home)).status).toBe(0);
      expect((await runCli(["config", "add", "other", "--server", otherUrl, "--token", "other-token"], home)).status).toBe(0);
      expect((await runCli(["config", "use", "other"], home)).status).toBe(0);

      const profileList = await runCli(["config", "list", "--json"], home);
      expect(profileList.status).toBe(0);
      expect(JSON.parse(profileList.stdout)).toEqual(expect.objectContaining({
        currentProfile: "other",
        profiles: expect.arrayContaining([
          expect.objectContaining({ name: "local", current: false }),
          expect.objectContaining({ name: "other", current: true, tokenConfigured: true })
        ])
      }));

      requests.length = 0;
      expect((await runCli(["script", "list", "--json"], home)).status).toBe(0);
      expect(requests.at(-1)?.headers.authorization).toBe("Bearer other-token");

      requests.length = 0;
      expect((await runCli(["script", "list", "--profile", "local", "--json"], home)).status).toBe(0);
      expect(requests.at(-1)?.headers.authorization).toBeUndefined();

      requests.length = 0;
      expect(
        (await runCli(["script", "list", "--profile", "other", "--json"], home, {
          ACTIONDOCK_BASE_URL: baseUrl,
          ACTIONDOCK_TOKEN: "env-token"
        })).status
      ).toBe(0);
      expect(requests.at(-1)?.headers.authorization).toBe("Bearer other-token");

      requests.length = 0;
      expect((await runCli(["script", "list", "--server", baseUrl, "--token", "flag-token", "--json"], home)).status).toBe(0);
      expect(requests.at(-1)?.headers.authorization).toBe("Bearer flag-token");
    } finally {
      await closeServer(otherServer);
    }
  }, 20000);

  it("supports ACTIONDOCK_PROFILE", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "actiondock-cli-home-"));
    expect((await runCli(["config", "add", "local", "--server", baseUrl, "--token", "env-profile-token"], home)).status).toBe(0);

    requests.length = 0;
    const result = await runCli(["script", "list", "--json"], home, { ACTIONDOCK_PROFILE: "local" });
    expect(result.status).toBe(0);
    expect(requests.at(-1)?.headers.authorization).toBe("Bearer env-profile-token");
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
    const child = spawn("node", ["./bin/run.js", ...args], {
      cwd: cliDir,
      env: {
        ...process.env,
        ...envOverrides,
        HOME: homeDir ?? process.env.HOME,
        XDG_CONFIG_HOME: homeDir ? path.join(homeDir, ".config-root") : process.env.XDG_CONFIG_HOME
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

async function listen(serverToStart: http.Server): Promise<string> {
  return await new Promise((resolve) => {
    serverToStart.listen(0, "127.0.0.1", () => {
      const address = serverToStart.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to start test server");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function closeServer(serverToClose: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => serverToClose.close((error) => (error ? reject(error) : resolve())));
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
