import { afterEach, describe, expect, it } from "vitest";
import { clearSkillInstallSession, readSkillInstallSession, writeSkillInstallSession } from "./skillInstallSession";

describe("skillInstallSession", () => {
  const sessionStorageMock = (() => {
    const storage = new Map<string, string>();
    return {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      }
    };
  })();

  (globalThis as { window?: { sessionStorage: typeof sessionStorageMock } }).window = {
    sessionStorage: sessionStorageMock
  };

  afterEach(() => {
    clearSkillInstallSession();
  });

  it("round trips repository install context", () => {
    writeSkillInstallSession({
      source: "REPOSITORY_REF",
      repositoryId: "repo-1",
      skillId: "skill-a",
      action: "update",
      returnTo: "/discover"
    });

    expect(readSkillInstallSession()).toEqual({
      source: "REPOSITORY_REF",
      repositoryId: "repo-1",
      skillId: "skill-a",
      action: "update",
      returnTo: "/discover"
    });
  });
});
