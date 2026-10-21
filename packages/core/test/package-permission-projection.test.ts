import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleInfoRoute } from "../src/server/routes/info";
import type { RouteContext } from "../src/server/types";
import type { ActionSummary, PackageInfo } from "../src/package/types";

const partialPackage: PackageInfo = {
  id: "@scope/pkg",
  name: "Scoped package",
  version: "1.0.0",
  config: { hidden: { type: "string", default: "secret" } },
};

function createContext(
  endpoint: "info" | "packages",
  pkg: PackageInfo,
  listActions: () => Promise<ActionSummary[]>
): RouteContext {
  const url = new URL(`http://localhost/api/v2/${endpoint}`);
  const unavailable = async (): Promise<never> => {
    throw new Error("unexpected service call");
  };
  return {
    req: new Request(url),
    url,
    pathname: url.pathname,
    corsHeaders: {},
    options: {},
    projectRoot: null,
    activePolicy: {
      actionAllowlist: ["@scope/pkg/read", "@scope/pkg/missing", " @scope/pkg/read "],
    },
    service: {
      info: async () => [pkg],
      discovery: {
        listPackages: async () => [pkg],
        listActions,
        describeAction: unavailable,
        listPlaybooks: async () => [],
        describePlaybook: unavailable,
      },
      execution: { run: unavailable, start: unavailable },
      runs: { list: async () => [], get: async () => undefined, cancel: unavailable },
      close: async () => {},
    },
  };
}

function getProjectedPackage(data: any) {
  return data.packages?.find((pkg: any) => pkg.id === partialPackage.id) || data;
}

describe("部分动作授权的最小身份投影", () => {
  for (const endpoint of ["info", "packages"] as const) {
    it(`${endpoint} 对带包身份的全限定目录引用统一归一化`, async () => {
      const response = await handleInfoRoute(createContext(endpoint, partialPackage, async () => [
        { id: "@scope/pkg/read", packageId: "@scope/pkg" },
        { id: "@scope/pkg/read", packageId: "@scope/pkg" },
        { id: "@scope/pkg/write", packageId: "@scope/pkg" },
      ]));
      assert.equal(response?.status, 200);
      const pkg = getProjectedPackage(await response!.json());
      assert.deepEqual(pkg.actions, ["read"]);
      assert.equal(pkg.actionsCount, 1);
      assert.equal(pkg.config, undefined);
    });

    it(`${endpoint} 目录没有动作时不得把授权声明伪装成已发现能力`, async () => {
      const response = await handleInfoRoute(createContext(endpoint, partialPackage, async () => []));
      assert.equal(response?.status, 200);
      const pkg = getProjectedPackage(await response!.json());
      assert.deepEqual(pkg.actions, []);
      assert.equal(pkg.actionsCount, 0);
    });

    it(`${endpoint} 必需的目录查询失败必须透明返回错误`, async () => {
      const response = await handleInfoRoute(createContext(endpoint, partialPackage, async () => {
        throw new Error("catalogue unavailable");
      }));
      assert.equal(response?.status, 500);
      const data = await response!.json();
      assert.equal(data.ok, false);
      assert.equal(data.error.message, "catalogue unavailable");
      assert.equal(data.error.code, endpoint === "info" ? "INFO_ERROR" : "PACKAGES_INFO_ERROR");
    });

    it(`${endpoint} 已有真实包清单时无需额外查询目录`, async () => {
      let catalogueCalls = 0;
      const response = await handleInfoRoute(createContext(
        endpoint,
        { ...partialPackage, actions: ["read", "write"] },
        async () => {
          catalogueCalls++;
          throw new Error("unnecessary lookup");
        }
      ));
      assert.equal(response?.status, 200);
      assert.equal(catalogueCalls, 0);
      assert.deepEqual(getProjectedPackage(await response!.json()).actions, ["read"]);
    });
  }
});
