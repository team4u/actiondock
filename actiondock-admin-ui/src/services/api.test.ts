import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.fn();
const emitAuthRequiredMock = vi.fn();

vi.mock("../shared/auth/tokenStore", () => ({
  getApiKey: getApiKeyMock,
  emitAuthRequired: emitAuthRequiredMock
}));

describe("api request auth handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds Authorization header when browser token exists", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listScripts } = await import("./api");
    await listScripts();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("omits Authorization header when browser token is empty", async () => {
    getApiKeyMock.mockReturnValue("");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listScripts } = await import("./api");
    await listScripts();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("emits auth-required and throws a 401 ApiError", async () => {
    getApiKeyMock.mockReturnValue("broken-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listScripts } = await import("./api");

    await expect(listScripts()).rejects.toEqual(
      expect.objectContaining({
        message: "访问令牌无效或缺失",
        status: 401
      })
    );
    expect(emitAuthRequiredMock).toHaveBeenCalledTimes(1);
  });

  it("does not force Content-Type for FormData uploads", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { installPlugin } = await import("./api");
    await installPlugin(new File(["plugin"], "plugin.jar"));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.has("Content-Type")).toBe(false);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("includes version in repository skill publish FormData", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: { repositoryId: "main", skillId: "demo-skill", displayName: "Demo Skill", version: "1.0.1" }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { publishRepositorySkillArchive } = await import("../features/resources/api");
    await publishRepositorySkillArchive("main", {
      version: "1.0.1",
      releaseNotes: "notes",
      archive: new File(["skill"], "demo-skill.zip")
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/repositories/main/publish-skill-archive");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get("version")).toBe("1.0.1");
    expect(formData.get("releaseNotes")).toBe("notes");
    expect(formData.get("archive")).toBeInstanceOf(File);
  });

  it("downloads binary archives with Authorization header", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["archive"]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { downloadInstalledSkillArchive } = await import("./api");
    const blob = await downloadInstalledSkillArchive("skill-1");

    expect(blob).toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/skills/skill-1/archive");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  it("scans GitHub skill collections through the stable endpoint", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: { skills: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { scanGithubSkillCollection } = await import("./api");
    await scanGithubSkillCollection("https://github.com/acme/skills");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/skills/github/scan");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://github.com/acme/skills" });
  });

  it("installs selected GitHub skills through the stable endpoint", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: { results: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { installGithubSkillCollection } = await import("./api");
    await installGithubSkillCollection({
      url: "https://github.com/acme/skills",
      targetIds: ["target-1"],
      skillPaths: ["skills/alpha"]
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/skills/github/install");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      url: "https://github.com/acme/skills",
      targetIds: ["target-1"],
      skillPaths: ["skills/alpha"]
    });
  });

  it("loads plugin references from the dedicated stable endpoint", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listPluginReferences } = await import("./api");
    await listPluginReferences();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/plugins/references");
  });

  it("deletes AI management resources through stable endpoints", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { deleteAiModel, deleteAiAgent, deleteAiToolset } = await import("./api");
    await deleteAiModel("model/one");
    await deleteAiAgent("agent/one");
    await deleteAiToolset("tools/one");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/ai/models/model%2Fone",
      "/api/ai/agents/agent%2Fone",
      "/api/ai/toolsets/tools%2Fone"
    ]);
    fetchMock.mock.calls.forEach((call) => {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method).toBe("DELETE");
    });
  });

  it("routes repository resource operations through the lifecycle endpoint", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: {
          resourceType: "REPOSITORY_SCRIPT",
          operation: "publish",
          repositoryId: "main",
          resourceId: null,
          status: "COMPLETED",
          result: { repositoryId: "main", scriptId: "hello", displayName: "Hello", version: "1.0.0" }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { publishRepositoryTool } = await import("./api");
    const result = await publishRepositoryTool("main", {
      scriptId: "script-1",
      repositoryScriptId: "hello",
      displayName: "Hello",
      version: "1.0.0",
      owner: "team",
      releaseNotes: "Initial",
      tags: ["demo"],
      scheduleIds: [],
      configItems: [],
      scriptDependencies: [],
      force: false
    });

    expect(result).toEqual({ repositoryId: "main", scriptId: "hello", displayName: "Hello", version: "1.0.0" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/resource-lifecycle/operations");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      resourceType: "REPOSITORY_SCRIPT",
      operation: "publish",
      repositoryId: "main",
      payload: {
        scriptId: "script-1",
        repositoryScriptId: "hello",
        displayName: "Hello",
        version: "1.0.0",
        owner: "team",
        releaseNotes: "Initial",
        tags: ["demo"],
        scheduleIds: [],
        configItems: [],
        scriptDependencies: [],
        force: false
      }
    });
  });

  it("routes webhook repository publish through the lifecycle endpoint", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: {
          resourceType: "REPOSITORY_WEBHOOK",
          operation: "publish",
          repositoryId: "main",
          resourceId: null,
          status: "COMPLETED",
          result: { repositoryId: "main", webhookId: "order-created", displayName: "Order Created", version: "1.0.0" }
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { publishRepositoryWebhook } = await import("../features/resources/api");
    const result = await publishRepositoryWebhook("main", {
      sourceId: "source-1",
      webhookId: "order-created",
      displayName: "Order Created",
      version: "1.0.0",
      owner: "team",
      releaseNotes: "Initial",
      tags: ["demo"],
      configItems: [{ key: "webhook.secret", publishMode: "PLACEHOLDER" }],
      scriptDependencies: [{ scriptId: "child", repositoryId: "main", repositoryScriptId: "child", versionRange: ">= 1.0.0" }],
      publishScriptDependencies: true,
      force: false
    });

    expect(result).toEqual({ repositoryId: "main", webhookId: "order-created", displayName: "Order Created", version: "1.0.0" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(init?.body as string)).toEqual({
      resourceType: "REPOSITORY_WEBHOOK",
      operation: "publish",
      repositoryId: "main",
      payload: {
        sourceId: "source-1",
        webhookId: "order-created",
        displayName: "Order Created",
        version: "1.0.0",
        owner: "team",
        releaseNotes: "Initial",
        tags: ["demo"],
        configItems: [{ key: "webhook.secret", publishMode: "PLACEHOLDER" }],
        scriptDependencies: [{ scriptId: "child", repositoryId: "main", repositoryScriptId: "child", versionRange: ">= 1.0.0" }],
        publishScriptDependencies: true,
        force: false
      }
    });
  });

  it("returns repository script descriptors with scriptId", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: [
          { repositoryId: "main", scriptId: "hello", displayName: "Hello", version: "1.0.0" }
        ]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRepositoryScripts } = await import("./api");
    const result = await listRepositoryScripts();

    expect(result[0]).toEqual(expect.objectContaining({
      repositoryId: "main",
      scriptId: "hello"
    }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/repositories/scripts");
  });

  it("returns repository script detail descriptors with scriptId", async () => {
    getApiKeyMock.mockReturnValue("secret-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: {
          descriptor: { repositoryId: "main", scriptId: "hello", displayName: "Hello", version: "1.0.0" },
          source: "return [:]",
          pythonRequirements: null,
          configTemplate: [],
          scheduleTemplate: []
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getRepositoryScript } = await import("./api");
    const result = await getRepositoryScript("main", "hello");

    expect(result.descriptor).toEqual(expect.objectContaining({
      repositoryId: "main",
      scriptId: "hello"
    }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/repositories/main/scripts/hello");
  });
});
