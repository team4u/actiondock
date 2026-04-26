import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.fn();
const emitAuthRequiredMock = vi.fn();

vi.mock("./auth", () => ({
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
});
