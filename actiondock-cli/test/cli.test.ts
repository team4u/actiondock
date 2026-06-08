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
          {
            id: "published-tool",
            name: "Published Tool",
            type: "GROOVY",
            publication: { published: true, dirty: false, publishedVersion: 7, publishedAt: "2026-04-01T00:00:00" },
            published: {
              scriptId: "published-tool",
              revisionId: "revision-published-tool",
              version: 7,
              publishedAt: "2026-04-01T00:00:00",
              name: "Published Tool",
              type: "GROOVY",
              packaging: "TOOL",
              description: "Generate a published greeting",
              inputSchema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  count: { type: "integer" },
                  payload: { type: "object" }
                }
              },
              outputSchema: {}
            }
          },
          {
            id: "draft-only-tool",
            name: "Draft Tool",
            type: "PYTHON",
            publication: { published: false, dirty: true },
            published: null
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/actuator/health") {
      return rawJson(res, {
        status: "UP",
        components: {
          db: { status: "UP" }
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts?intent=published") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "published-tool",
            name: "Published Tool",
            type: "GROOVY",
            publication: { published: true, dirty: false, publishedVersion: 7, publishedAt: "2026-04-01T00:00:00" },
            published: {
              scriptId: "published-tool",
              revisionId: "revision-published-tool",
              version: 7,
              publishedAt: "2026-04-01T00:00:00",
              name: "Published Tool",
              type: "GROOVY",
              packaging: "TOOL",
              description: "Generate a published greeting",
              inputSchema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" }
                }
              },
              outputSchema: {}
            }
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts?intent=missing") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: []
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
          version: 7,
          publication: { published: true, dirty: false, publishedVersion: 7, publishedAt: "2026-04-01T00:00:00" },
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" }
            }
          },
          published: {
            scriptId: "published-tool",
            revisionId: "revision-published-tool",
            version: 7,
            publishedAt: "2026-04-01T00:00:00",
            name: "Published Tool",
            type: "GROOVY",
            packaging: "TOOL",
            description: "Generate a published greeting",
            inputSchema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                count: { type: "integer" },
                payload: { type: "object" }
              }
            },
            outputSchema: {}
          }
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/published") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          scriptId: "published-tool",
          revisionId: "revision-published-tool",
          version: 7,
          publishedAt: "2026-04-01T00:00:00",
          name: "Published Tool",
          type: "GROOVY",
          packaging: "TOOL",
          description: "Generate a published greeting",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              count: { type: "integer" },
              payload: { type: "object" }
            }
          },
          outputSchema: {}
        }
      });
    }

    if (req.method === "PATCH" && req.url === "/api/scripts/published-tool") {
      return json(res, {
        status: 0,
        msg: "patched",
        data: {
          id: "published-tool",
          name: body?.name ?? "Published Tool",
          description: body?.description ?? "Generate a published greeting",
          type: "GROOVY",
          source: body?.source ?? "return [message: 'draft']",
          inputSchema: body?.inputSchema ?? {},
          outputSchema: body?.outputSchema ?? {},
          publication: { published: true, dirty: true, publishedVersion: 7, publishedAt: "2026-04-01T00:00:00" },
          published: null
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
          version: 1,
          publication: { published: false, dirty: true },
          published: null
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/published-tool/upstream") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          localAssetId: "published-tool",
          repositoryId: "repo-1",
          upstreamAssetId: "tool-1",
          upstreamVersion: "1.0.0",
          dirty: false,
          remoteChanged: true,
          syncState: "REMOTE_CHANGES",
          remoteVersion: "1.0.1",
          lastSyncedAt: "2026-05-01T00:00:00"
        }
      });
    }

    if (req.method === "GET" && req.url === "/api/scripts/local-only/upstream") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/scripts/published-tool/upstream/pull?force=true") {
      return json(res, {
        status: 0,
        msg: "pulled",
        data: {
          id: "published-tool",
          name: "Published Tool",
          type: "GROOVY",
          version: 8,
          repositoryId: "repo-1",
          repositoryScriptId: "tool-1",
          repositoryVersion: "1.0.1",
          publication: { published: false, dirty: false },
          published: null
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

    if (req.method === "GET" && req.url === "/api/webhooks") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "source-1",
            key: "github.issue",
            name: "GitHub Issue",
            enabled: true,
            transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/webhooks/source-1" },
            webhookScriptId: "script-github-webhook"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/webhooks/source-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "source-1",
          key: "github.issue",
          name: "GitHub Issue",
          description: "GitHub webhook source",
          enabled: true,
          transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/webhooks/source-1", contentTypes: ["*/*"] },
          webhookScriptId: "script-github-webhook",
          sampleRequest: {
            method: "POST",
            headers: { "X-GitHub-Event": ["issues"] },
            query: {},
            rawBody: "{\"action\":\"opened\"}",
            contentType: "application/json"
          },
          lastReceivedAt: "2026-04-29T00:00:00"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/webhooks") {
      return json(res, {
        status: 0,
        msg: "created",
        data: body
      });
    }

    if (req.method === "PUT" && req.url === "/api/webhooks/source-1") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: body
      });
    }

    if (req.method === "POST" && req.url === "/api/webhooks/source-1/enable") {
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

    if (req.method === "POST" && req.url === "/api/webhooks/source-1/disable") {
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

    if (req.method === "DELETE" && req.url === "/api/webhooks/source-1") {
      return json(res, {
        status: 0,
        msg: "deleted",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/webhooks/source-1") {
      res.statusCode = 202;
      res.setHeader("content-type", "application/json;charset=UTF-8");
      res.setHeader("x-ack", "ok");
      res.end(JSON.stringify({
        ok: true,
        webhookId: "source-1",
        request: body
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/webhooks/source-1/upstream") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: null
      });
    }

    if (req.method === "POST" && req.url === "/api/resource-lifecycle/operations" && body?.resourceType === "REPOSITORY_WEBHOOK" && body?.operation === "publish") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          resourceType: "REPOSITORY_WEBHOOK",
          operation: "publish",
          repositoryId: body.repositoryId,
          resourceId: null,
          status: "COMPLETED",
          result: {
            repositoryId: body.repositoryId,
            webhookId: body.payload?.webhookId,
            displayName: body.payload?.displayName,
            version: body.payload?.version,
            description: "Published Webhook",
            tags: body.payload?.tags ?? [],
            scriptDependencies: body.payload?.scriptDependencies ?? [],
            trusted: true
          }
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
            actionCount: 1
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/plugins?intent=plugin-a") {
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
            actionCount: 1
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
          description: "Plugin A tools",
          version: "1.2.3",
          actions: [
            {
              action: "summarize",
              title: "Summarize",
              description: "Summarize a topic",
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

    if (req.method === "GET" && req.url === "/api/repositories/scripts") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            repositoryId: "repo-1",
            scriptId: "tool-1",
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

    if (req.method === "GET" && req.url === "/api/repositories/repo-1/scripts/tool-1") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          descriptor: {
            repositoryId: "repo-1",
            scriptId: "tool-1",
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

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/scripts/tool-1/local-assets") {
      return json(res, {
        status: 0,
        msg: "installed",
        data: {
          id: `SCRIPT:${body?.mode ?? "LOCKED"}:${body?.localAssetId ?? "repo-1.tool-1"}`,
          assetType: "SCRIPT",
          localAssetId: body?.localAssetId ?? "repo-1.tool-1",
          repositoryId: "repo-1",
          upstreamAssetId: "tool-1",
          mode: body?.mode ?? "LOCKED",
          name: "Tool 1",
          version: "1.0.0",
          latestVersion: "1.0.0"
        }
      });
    }

    if (req.method === "POST" && req.url === "/api/repositories/repo-1/scripts/tool-1/local-assets/update") {
      return json(res, {
        status: 0,
        msg: "updated",
        data: {
          id: "SCRIPT:LOCKED:repo-1.tool-1",
          assetType: "SCRIPT",
          localAssetId: "repo-1.tool-1",
          repositoryId: "repo-1",
          upstreamAssetId: "tool-1",
          mode: "LOCKED",
          name: "Tool 1",
          version: "1.0.1",
          latestVersion: "1.0.1"
        }
      });
    }

    if (req.method === "DELETE" && req.url === "/api/installed-scripts/published-tool") {
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

    if (req.method === "GET" && req.url === "/api/playbooks") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "refund-failure",
            name: "退款失败排查",
            description: "定位退款失败根因并给出下一步建议",
            tags: ["refund", "payment"],
            riskLevel: "MEDIUM",
            repositoryIds: ["billing-service"],
            knowledgeRefs: [
              { type: "FILE", repositoryId: "billing-service", path: "docs/runbooks/refund-runbook.md" }
            ],
            scriptRefs: [
              { scriptId: "query-log", purpose: "查询退款链路日志" }
            ],
            agentSkillRefs: [
              { skillId: "openai-docs", purpose: "查官方文档", required: false }
            ],
            relatedPlaybookRefs: [
              { playbookId: "generic-project-investigation", relation: "FALLBACK", purpose: "退回通用项目调查" }
            ],
            guideMarkdown: "先读取 ACTIONDOCK.md，再查看 refund-runbook.md。",
            stopConditions: ["缺少关键上下文", "需要人工确认"],
            enabled: true,
            managed: false,
            createdAt: "2026-05-01T00:00:00",
            updatedAt: "2026-05-02T00:00:00"
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/playbooks?repositoryId=billing-service&tag=refund&enabled=true&managed=true&intent=%E9%80%80%E6%AC%BE") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: [
          {
            id: "refund-failure",
            name: "退款失败排查",
            description: "定位退款失败根因并给出下一步建议",
            tags: ["refund", "payment"],
            riskLevel: "MEDIUM",
            repositoryIds: ["billing-service"],
            knowledgeRefs: [
              { type: "FILE", repositoryId: "billing-service", path: "docs/runbooks/refund-runbook.md" }
            ],
            scriptRefs: [
              { scriptId: "query-log", purpose: "查询退款链路日志" }
            ],
            agentSkillRefs: [
              { skillId: "openai-docs", purpose: "查官方文档", required: false }
            ],
            relatedPlaybookRefs: [
              { playbookId: "generic-project-investigation", relation: "FALLBACK", purpose: "退回通用项目调查" }
            ],
            guideMarkdown: "先读取 ACTIONDOCK.md，再查看 refund-runbook.md。",
            stopConditions: ["缺少关键上下文", "需要人工确认"],
            enabled: true,
            managed: true
          }
        ]
      });
    }

    if (req.method === "GET" && req.url === "/api/playbooks/refund-failure") {
      return json(res, {
        status: 0,
        msg: "ok",
        data: {
          id: "refund-failure",
          name: "退款失败排查",
          description: "定位退款失败根因并给出下一步建议",
          tags: ["refund", "payment"],
          riskLevel: "MEDIUM",
          repositoryIds: ["billing-service"],
          knowledgeRefs: [
            { type: "NOTE", repositoryId: "billing-service", markdown: "先看退款链路背景。" },
            { type: "FILE", repositoryId: "billing-service", path: "docs/runbooks/refund-runbook.md" }
          ],
          scriptRefs: [
            { scriptId: "query-log", purpose: "查询退款链路日志" }
          ],
          agentSkillRefs: [
            { skillId: "openai-docs", purpose: "查官方文档", required: false }
          ],
          relatedPlaybookRefs: [
            { playbookId: "generic-project-investigation", relation: "FALLBACK", purpose: "退回通用项目调查" }
          ],
          guideMarkdown: "先读取 ACTIONDOCK.md，再查看 refund-runbook.md。",
          stopConditions: ["缺少关键上下文", "需要人工确认"],
          enabled: true,
          managed: false,
          createdAt: "2026-05-01T00:00:00",
          updatedAt: "2026-05-02T00:00:00"
        }
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
  }, 15000);

  it("passes list intent to server and falls back when intent has no match", async () => {
    requests.length = 0;
    const matched = await runCli(["script", "list", "--intent", "published", "--server", baseUrl, "--json"]);
    expect(matched.status).toBe(0);
    expect(JSON.parse(matched.stdout)).toEqual([
      expect.objectContaining({
        id: "published-tool"
      })
    ]);
    expect(requests.map((item) => item.url)).toContain("/api/scripts?intent=published");

    requests.length = 0;
    const fallback = await runCli(["script", "list", "--intent", "missing", "--server", baseUrl, "--json"]);
    expect(fallback.status).toBe(0);
    expect(JSON.parse(fallback.stdout)).toEqual([
      expect.objectContaining({
        id: "published-tool"
      })
    ]);
    expect(requests.map((item) => item.url)).toEqual([
      "/api/scripts?intent=missing",
      "/api/scripts"
    ]);
  }, 15000);

  it("returns schema detail as JSON", async () => {
    const result = await runCli(["script", "schema", "published-tool", "--server", baseUrl, "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        target: "published",
        script: expect.objectContaining({
          description: "Generate a published greeting"
        }),
        flagFields: [
          expect.objectContaining({ name: "name" }),
          expect.objectContaining({ name: "count" })
        ],
        jsonOnlyFields: [
          expect.objectContaining({ name: "payload" })
        ],
        exampleInput: {
          name: "name-example",
          count: 1,
          payload: {}
        },
        exampleCliCommand: "actiondock script run 'published-tool' --name 'name-example' --count '1' --input-json '{\"payload\":{}}'"
      })
    );

    const textResult = await runCli(["script", "schema", "published-tool", "--server", baseUrl]);
    expect(textResult.status).toBe(0);
    expect(textResult.stdout).toContain("Description: Generate a published greeting");
    expect(textResult.stdout).toContain("Example CLI:");
    expect(textResult.stdout).toContain("actiondock script run 'published-tool' --name 'name-example' --count '1' --input-json '{\"payload\":{}}'");
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

  it("patches script metadata and schema aliases", async () => {
    requests.length = 0;
    const result = await runCli([
      "script",
      "patch",
      "published-tool",
      "--server",
      baseUrl,
      "--name",
      "Updated Tool",
      "--desc",
      "Updated description",
      "--input-schema-json",
      '{"properties":{"enabled":{"type":"boolean"}}}',
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        id: "published-tool",
        name: "Updated Tool",
        description: "Updated description"
      })
    );

    const patchRequest = requests.find((item) => item.method === "PATCH" && item.url === "/api/scripts/published-tool");
    expect(patchRequest?.body).toEqual({
      name: "Updated Tool",
      description: "Updated description",
      inputSchema: {
        properties: {
          enabled: { type: "boolean" },
          name: null
        }
      }
    });

    requests.length = 0;
    const aliasResult = await runCli([
      "script",
      "patch",
      "published-tool",
      "--server",
      baseUrl,
      "--patch-json",
      '{"desc":"Alias description","inputSchemaPatch":{"required":["enabled"]},"outputSchemaPatch":{"type":"object"}}',
      "--json"
    ]);
    expect(aliasResult.status).toBe(0);
    expect(requests.find((item) => item.method === "PATCH" && item.url === "/api/scripts/published-tool")?.body).toEqual({
      description: "Alias description",
      inputSchema: { required: ["enabled"] },
      outputSchema: { type: "object" }
    });
  });

  it("rejects duplicate script patch aliases", async () => {
    const result = await runCli([
      "script",
      "patch",
      "published-tool",
      "--server",
      baseUrl,
      "--patch-json",
      '{"description":"canonical","desc":"alias"}',
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual(
      expect.objectContaining({
        error: "Patch 字段重复定义: description"
      })
    );
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

    const status = await runCli(["script", "upstream-status", "published-tool", "--server", baseUrl, "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(
      expect.objectContaining({
        localAssetId: "published-tool",
        syncState: "REMOTE_CHANGES"
      })
    );

    const localOnlyStatus = await runCli(["script", "upstream-status", "local-only", "--server", baseUrl]);
    expect(localOnlyStatus.status).toBe(0);
    expect(localOnlyStatus.stdout.trim()).toBe("No upstream binding");

    const pull = await runCli(["script", "upstream-pull", "published-tool", "--force", "--server", baseUrl, "--json"]);
    expect(pull.status).toBe(0);
    expect(JSON.parse(pull.stdout)).toEqual(
      expect.objectContaining({
        id: "published-tool",
        repositoryVersion: "1.0.1"
      })
    );
    expect(requests.some((item) => item.method === "POST" && item.url === "/api/scripts/published-tool/upstream/pull?force=true")).toBe(true);

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

  it("manages Webhooks through cli", async () => {
    const list = await runCli(["webhook", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        id: "source-1",
        key: "github.issue"
      })
    ]);

    const detail = await runCli(["webhook", "get", "source-1", "--server", baseUrl, "--json"]);
    expect(detail.status).toBe(0);
    expect(JSON.parse(detail.stdout)).toEqual(
      expect.objectContaining({
        id: "source-1",
        webhookScriptId: "script-github-webhook"
      })
    );

    const createDefinition = {
      id: "source-2",
      key: "custom.crm",
      name: "Custom CRM",
      transport: { type: "HTTP_WEBHOOK" },
      webhookScriptId: "script-crm-webhook",
      sampleRequest: {
        method: "POST",
        headers: { "X-CRM-Event": ["lead.created"] },
        query: {},
        rawBody: "{\"type\":\"lead.created\"}",
        contentType: "application/json"
      }
    };
    const created = await runCli([
      "webhook",
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

    const createRequest = requests.find((item) => item.method === "POST" && item.url === "/api/webhooks");
    expect(createRequest?.body).toEqual({
      id: "source-2",
      key: "custom.crm",
      name: "Custom CRM Source",
      transport: { type: "HTTP_WEBHOOK" },
      webhookScriptId: "script-crm-webhook",
      sampleRequest: {
        method: "POST",
        headers: { "X-CRM-Event": ["lead.created"] },
        query: {},
        rawBody: "{\"type\":\"lead.created\"}",
        contentType: "application/json"
      },
      enabled: false
    });

    const updated = await runCli([
      "webhook",
      "update",
      "source-1",
      "--definition-json",
      '{"sampleRequest":{"method":"POST","headers":{"X-GitHub-Event":["issues"]},"query":{"tenant":["acme"]},"rawBody":"{\\"action\\":\\"reopened\\"}","contentType":"application/json"}}',
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

    const updateRequest = requests.find((item) => item.method === "PUT" && item.url === "/api/webhooks/source-1");
    expect(updateRequest?.body).toEqual({
      id: "source-1",
      key: "github.issue",
      name: "GitHub Issue",
      description: "Updated source",
      enabled: true,
      transport: { type: "HTTP_WEBHOOK", endpointPath: "/api/webhooks/source-1", contentTypes: ["*/*"] },
      webhookScriptId: "script-github-webhook",
      sampleRequest: {
        method: "POST",
        headers: { "X-GitHub-Event": ["issues"] },
        query: { tenant: ["acme"] },
        rawBody: "{\"action\":\"reopened\"}",
        contentType: "application/json"
      },
      lastReceivedAt: "2026-04-29T00:00:00"
    });

    expect((await runCli(["webhook", "enable", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["webhook", "disable", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const upstreamStatus = await runCli(["webhook", "upstream-status", "source-1", "--server", baseUrl]);
    expect(upstreamStatus.status).toBe(0);
    expect(upstreamStatus.stdout.trim()).toBe("No upstream binding");

    const webhook = await runCli([
      "webhook",
      "invoke",
      "source-1",
      "--payload-json",
      '{"method":"POST","path":"/api/webhooks/source-1","headers":{"X-GitHub-Event":["issues"]},"query":{"tenant":["acme"]},"rawBody":"{\\"action\\":\\"opened\\"}","contentType":"application/json"}',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(webhook.status).toBe(0);
    expect(JSON.parse(webhook.stdout)).toEqual(
      expect.objectContaining({
        status: 202,
        body: expect.objectContaining({
          webhookId: "source-1",
          request: expect.objectContaining({
            method: "POST"
          })
        }),
        headers: expect.objectContaining({
          "x-ack": ["ok"]
        })
      })
    );

    expect((await runCli(["webhook", "delete", "source-1", "--server", baseUrl, "--json"])).status).toBe(0);
  }, 15000);

  it("publishes webhook to repository", async () => {
    const result = await runCli([
      "webhook",
      "publish",
      "source-1",
      "--repository",
      "repo-1",
      "--repository-webhook-id",
      "order-created",
      "--display-name",
      "Order Created",
      "--version",
      "1.0.0",
      "--owner",
      "team",
      "--release-notes",
      "Initial",
      "--tag",
      "demo",
      "--script-dependencies-json",
      '[{"scriptId":"child","repositoryId":"repo-1","repositoryScriptId":"child-tool","versionRange":">= 1.0.0"}]',
      "--config-items-json",
      '[{"key":"webhook.secret","publishMode":"PLACEHOLDER"}]',
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        repositoryId: "repo-1",
        webhookId: "order-created",
        displayName: "Order Created",
        version: "1.0.0"
      })
    );

    const publishRequest = requests.find((item) =>
      item.method === "POST"
      && item.url === "/api/resource-lifecycle/operations"
      && item.body?.resourceType === "REPOSITORY_WEBHOOK"
      && item.body?.operation === "publish"
    );
    expect(publishRequest?.body).toEqual({
      resourceType: "REPOSITORY_WEBHOOK",
      operation: "publish",
      repositoryId: "repo-1",
      payload: {
        sourceId: "source-1",
        webhookId: "order-created",
        displayName: "Order Created",
        version: "1.0.0",
        owner: "team",
        releaseNotes: "Initial",
        tags: ["demo"],
        publishScriptDependencies: true,
        scriptDependencies: [
          {
            scriptId: "child",
            repositoryId: "repo-1",
            repositoryScriptId: "child-tool",
            versionRange: ">= 1.0.0"
          }
        ],
        configItems: [
          {
            key: "webhook.secret",
            publishMode: "PLACEHOLDER"
          }
        ],
        force: false
      }
    });
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

  it("uses plugin args labels when rejecting complex dynamic plugin args", async () => {
    const result = await runCli([
      "plugin",
      "invoke",
      "plugin-a",
      "summarize",
      "--server",
      baseUrl,
      "--topic",
      "ops",
      "--payload",
      '{"scope":"night"}',
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual(
      expect.objectContaining({
        error: "字段 payload 属于 object，请改用 `--args-json` 或 `--args-file` 提供。"
      })
    );
  });

  it("lists plugins, references, and config", async () => {
    const list = await runCli(["plugin", "list", "--server", baseUrl, "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        pluginId: "plugin-a",
        actionCount: 1
      })
    ]);
    expect(JSON.parse(list.stdout)[0].actions).toBeUndefined();

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
    const detailJson = JSON.parse(detail.stdout);
    expect(detailJson).toEqual(
      expect.objectContaining({
        pluginId: "plugin-a",
        version: "1.2.3"
      })
    );
    expect(detailJson.actions).toEqual([
      { action: "summarize", title: "Summarize", description: "Summarize a topic" }
    ]);

    const detailText = await runCli(["plugin", "get", "plugin-a", "--server", baseUrl]);
    expect(detailText.status).toBe(0);
    expect(detailText.stdout).toContain("Description: Plugin A tools");
    expect(detailText.stdout).toContain("summarize (Summarize) - Summarize a topic");

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

  it("shows single action schema with plugin action command", async () => {
    const actionJson = await runCli(["plugin", "action", "plugin-a", "summarize", "--server", baseUrl, "--json"]);
    expect(actionJson.status).toBe(0);
    const parsed = JSON.parse(actionJson.stdout);
    expect(parsed).toEqual(
      expect.objectContaining({
        action: "summarize",
        title: "Summarize",
        exampleArgs: {
          topic: "topic-example",
          retries: 1,
          payload: {}
        },
        exampleCliCommand: "actiondock plugin invoke 'plugin-a' 'summarize' --topic 'topic-example' --retries '1' --args-json '{\"payload\":{}}'"
      })
    );
    expect(parsed.inputSchema).toBeDefined();
    expect(parsed.inputSchema.properties.topic).toBeDefined();

    const actionText = await runCli(["plugin", "action", "plugin-a", "summarize", "--server", baseUrl]);
    expect(actionText.status).toBe(0);
    expect(actionText.stdout).toContain("Action: summarize (Summarize)");
    expect(actionText.stdout).toContain("--topic <string> required");
    expect(actionText.stdout).toContain("JSON-only fields:");
    expect(actionText.stdout).toContain("payload <object>");
    expect(actionText.stdout).toContain("Example CLI:");
    expect(actionText.stdout).toContain("actiondock plugin invoke 'plugin-a' 'summarize' --topic 'topic-example' --retries '1' --args-json '{\"payload\":{}}'");

    const notFound = await runCli(["plugin", "action", "plugin-a", "nonexistent", "--server", baseUrl, "--json"]);
    expect(notFound.status).toBe(2);
    expect(notFound.stderr).toContain("不存在动作 nonexistent");
    expect(notFound.stderr).toContain("可用:");
    expect(notFound.stderr).toContain("summarize");
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
      trustLevel: "TRUSTED",
      enabled: true
    });

    expect((await runCli(["repository", "sync", "repo-1", "--server", baseUrl, "--json"])).status).toBe(0);
    expect((await runCli(["repository", "delete", "repo-1", "--server", baseUrl, "--json"])).status).toBe(0);

    const toolList = await runCli(["script", "repository-list", "--server", baseUrl, "--json"]);
    expect(toolList.status).toBe(0);
    expect(JSON.parse(toolList.stdout)).toEqual([
      expect.objectContaining({
        repositoryId: "repo-1",
        scriptId: "tool-1"
      })
    ]);

    const toolDetail = await runCli(["script", "repository-get", "repo-1", "tool-1", "--server", baseUrl, "--json"]);
    expect(toolDetail.status).toBe(0);
    expect(JSON.parse(toolDetail.stdout)).toEqual(
      expect.objectContaining({
        descriptor: expect.objectContaining({ scriptId: "tool-1" })
      })
    );

    const install = await runCli([
      "script",
      "repository-install",
      "repo-1",
      "tool-1",
      "--install-schedules",
      "--install-plugin-dependencies",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(install.status).toBe(0);
    const installRequest = requests.find((item) => item.method === "POST" && item.url === "/api/repositories/repo-1/scripts/tool-1/local-assets");
    expect(installRequest?.body).toEqual({
      mode: "LOCKED",
      installSchedules: true,
      installScriptDependencies: false,
      installPluginDependencies: true,
      forcePluginUpgrade: false
    });

    expect((await runCli(["script", "repository-update", "repo-1", "tool-1", "--server", baseUrl, "--json"])).status).toBe(0);
    const updateRequest = requests.find((item) => item.method === "POST" && item.url === "/api/repositories/repo-1/scripts/tool-1/local-assets/update");
    expect(updateRequest?.body).toEqual({
      installSchedules: false,
      installScriptDependencies: false,
      installPluginDependencies: false,
      forcePluginUpgrade: false
    });

    const develop = await runCli(["script", "repository-working-copy", "repo-1", "tool-1", "--script-id", "tool-dev", "--server", baseUrl, "--json"]);
    expect(develop.status).toBe(0);
    expect(JSON.parse(develop.stdout)).toEqual(
      expect.objectContaining({
        localAssetId: "tool-dev",
        mode: "TRACKED",
        upstreamAssetId: "tool-1"
      })
    );
    const workingCopyRequest = requests.find((item) =>
      item.method === "POST" &&
      item.url === "/api/repositories/repo-1/scripts/tool-1/local-assets" &&
      item.body?.mode === "TRACKED"
    );
    expect(workingCopyRequest?.body).toEqual({
      mode: "TRACKED",
      installSchedules: false,
      installScriptDependencies: false,
      installPluginDependencies: false,
      forcePluginUpgrade: false,
      localAssetId: "tool-dev"
    });

    const uninstall = await runCli(["script", "repository-uninstall", "published-tool", "--server", baseUrl, "--json"]);
    expect(uninstall.status).toBe(0);
    expect(JSON.parse(uninstall.stdout)).toEqual({
      uninstalled: true,
      scriptId: "published-tool"
    });
    expect(requests.some((item) => item.method === "DELETE" && item.url === "/api/installed-scripts/published-tool")).toBe(true);
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

  it("returns playbook list summaries for json output", async () => {
    const result = await runCli(["playbook", "list", "--server", baseUrl, "--json"]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual([
      {
        id: "refund-failure",
        name: "退款失败排查",
        description: "定位退款失败根因并给出下一步建议",
        tags: ["refund", "payment"],
        riskLevel: "MEDIUM",
        repositoryIds: ["billing-service"],
        enabled: true,
        managed: false
      }
    ]);

    expect(parsed[0].guideMarkdown).toBeUndefined();
    expect(parsed[0].knowledgeRefs).toBeUndefined();
    expect(parsed[0].scriptRefs).toBeUndefined();
    expect(parsed[0].stopConditions).toBeUndefined();
    expect(parsed[0].createdAt).toBeUndefined();
    expect(parsed[0].updatedAt).toBeUndefined();
  });

  it("passes playbook list filters and intent through and keeps text output", async () => {
    requests.length = 0;
    const jsonResult = await runCli([
      "playbook",
      "list",
      "--repository-id",
      "billing-service",
      "--tag",
      "refund",
      "--enabled",
      "--managed",
      "--intent",
      "退款",
      "--server",
      baseUrl,
      "--json"
    ]);
    expect(jsonResult.status).toBe(0);
    expect(requests.some((item) => item.method === "GET" && item.url === "/api/playbooks?repositoryId=billing-service&tag=refund&enabled=true&managed=true&intent=%E9%80%80%E6%AC%BE")).toBe(true);

    const textResult = await runCli(["playbook", "list", "--server", baseUrl]);
    expect(textResult.status).toBe(0);
    expect(textResult.stdout).toContain("refund-failure");
    expect(textResult.stdout).toContain("risk=MEDIUM");
  });

  it("returns full playbook details through get", async () => {
    const jsonResult = await runCli(["playbook", "get", "refund-failure", "--server", baseUrl, "--json"]);
    expect(jsonResult.status).toBe(0);
    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed.guideMarkdown).toBe("先读取 ACTIONDOCK.md，再查看 refund-runbook.md。");
    expect(parsed.knowledgeRefs).toHaveLength(2);
    expect(parsed.scriptRefs).toHaveLength(1);
    expect(parsed.agentSkillRefs).toHaveLength(1);
    expect(parsed.relatedPlaybookRefs).toHaveLength(1);
    expect(parsed.stopConditions).toEqual(["缺少关键上下文", "需要人工确认"]);

    const textResult = await runCli(["playbook", "get", "refund-failure", "--server", baseUrl]);
    expect(textResult.status).toBe(0);
    expect(textResult.stdout).toContain("Guide:");
    expect(textResult.stdout).toContain("docs/runbooks/refund-runbook.md");
    expect(textResult.stdout).toContain("query-log - 查询退款链路日志");
    expect(textResult.stdout).toContain("openai-docs optional - 查官方文档");
    expect(textResult.stdout).toContain("FALLBACK generic-project-investigation - 退回通用项目调查");
    expect(textResult.stdout).toContain("缺少关键上下文");
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

  it("checks server health without listing scripts", async () => {
    requests.length = 0;

    const result = await runCli(["health", "--server", baseUrl, "--json"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      server: baseUrl,
      status: "UP",
      details: {
        status: "UP",
        components: {
          db: { status: "UP" }
        }
      }
    });
    expect(requests.map((request) => request.url)).toEqual(["/actuator/health"]);
  });

  it("writes json output to a file and keeps stdout short", async () => {
    const outputFile = path.join(os.tmpdir(), `actiondock-cli-output-${Date.now()}.json`);
    try {
      const result = await runCli([
        "script", "run", "published-tool",
        "--server", baseUrl,
        "--name", "alice",
        "--json",
        "--output-file", outputFile
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        outputFile,
        bytes: fs.statSync(outputFile).size
      });
      expect(JSON.parse(fs.readFileSync(outputFile, "utf8"))).toEqual(
        expect.objectContaining({
          id: "exec-1",
          status: "SUCCESS",
          output: {
            input: { name: "alice" },
            mode: "SYNC",
            responseView: "RESULT"
          }
        })
      );
    } finally {
      fs.rmSync(outputFile, { force: true });
    }
  });

  it("refuses to overwrite json output files unless explicitly allowed", async () => {
    const outputFile = path.join(os.tmpdir(), `actiondock-cli-existing-${Date.now()}.json`);
    fs.writeFileSync(outputFile, "existing", "utf8");
    try {
      const blocked = await runCli(["health", "--server", baseUrl, "--json", "--output-file", outputFile]);

      expect(blocked.status).toBe(2);
      expect(blocked.stderr).toContain("输出文件已存在");
      expect(fs.readFileSync(outputFile, "utf8")).toBe("existing");

      const overwritten = await runCli(["health", "--server", baseUrl, "--json", "--output-file", outputFile, "--overwrite-output"]);
      expect(overwritten.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(outputFile, "utf8"))).toEqual(
        expect.objectContaining({ ok: true, status: "UP" })
      );
    } finally {
      fs.rmSync(outputFile, { force: true });
    }
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

function rawJson(response: http.ServerResponse, payload: unknown): void {
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
