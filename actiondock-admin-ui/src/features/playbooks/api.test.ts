import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getApiKeyMock = vi.fn();
const emitAuthRequiredMock = vi.fn();

vi.mock("../../shared/auth/tokenStore", () => ({
  getApiKey: getApiKeyMock,
  emitAuthRequired: emitAuthRequiredMock
}));

describe("playbook api", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getApiKeyMock.mockReturnValue("");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists playbook sessions with filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 0, msg: "ok", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listPlaybookSessions } = await import("./api");
    await listPlaybookSessions({
      playbookId: "refund",
      status: "RUNNING",
      agentRunId: "run/1",
      intent: "退款失败"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/playbook-sessions?playbookId=refund&status=RUNNING&agentRunId=run%2F1&intent=%E9%80%80%E6%AC%BE%E5%A4%B1%E8%B4%A5");
  });

  it("gets playbook session detail with encoded id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        status: 0,
        msg: "ok",
        data: { session: { id: "pbs/1", playbookId: "refund", status: "RUNNING", currentPhase: "ROUTE" }, events: [] }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getPlaybookSession } = await import("./api");
    await getPlaybookSession("pbs/1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/playbook-sessions/pbs%2F1");
  });
});
