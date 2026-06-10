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
});
