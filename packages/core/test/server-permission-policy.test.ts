import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterActionsByPolicy,
  filterPackagesByPolicy,
  isActionAllowed,
  isActionAllowedByPolicy,
  isFullAccessGranted,
  isManagementAllowedByPolicy,
  isPackageAllowedByPolicy,
  isPackageVisibleByPolicy,
  normalizeServerViews,
  requiresMinimalPackageProjection,
} from "../src/server";

const unionPolicy = {
  viewName: "agent",
  packageAllowlist: ["pkg.a"],
  actionAllowlist: ["pkg.b/read"],
};

describe("服务端白名单并集策略单测", () => {
  describe("assertServerPolicyValid 白名单配置校验（fail closed）", () => {
    it("接受合法形态：省略、空数组、包列表、全限定动作列表与两者并集", () => {
      // 直接通过归一化入口验证，涵盖默认视图与命名视图
      assert.doesNotThrow(() => normalizeServerViews({}));
      assert.doesNotThrow(() => normalizeServerViews({ packageAllowlist: [] }));
      assert.doesNotThrow(() => normalizeServerViews({ actionAllowlist: [] }));
      assert.doesNotThrow(() => normalizeServerViews({ packageAllowlist: ["pkg.a", "pkg.b"] }));
      assert.doesNotThrow(() => normalizeServerViews({ actionAllowlist: ["pkg.a/read"] }));
      assert.doesNotThrow(() =>
        normalizeServerViews({ packageAllowlist: ["pkg.a"], actionAllowlist: ["pkg.b/read"] })
      );
      assert.doesNotThrow(() => normalizeServerViews({ packageAllowlist: ["*"] }));
      assert.doesNotThrow(() =>
        normalizeServerViews({
          views: {
            agent: { token: "t", packageAllowlist: ["pkg.a"], actionAllowlist: ["pkg.b/read"] },
          },
        })
      );
    });

    it("拒绝非数组与非法元素类型", () => {
      assert.throws(() => normalizeServerViews({ packageAllowlist: "pkg.a" as any }), (err: any) =>
        err instanceof Error && err.message.includes("packageAllowlist")
      );
      assert.throws(() => normalizeServerViews({ actionAllowlist: "pkg.a/read" as any }), (err: any) =>
        err instanceof Error && err.message.includes("actionAllowlist")
      );
      assert.throws(() => normalizeServerViews({ packageAllowlist: [42] as any }), (err: any) =>
        err instanceof Error && err.message.includes("non-empty string")
      );
      assert.throws(() => normalizeServerViews({ actionAllowlist: [null as any] }), (err: any) =>
        err instanceof Error && err.message.includes("non-empty string")
      );
    });

    it("拒绝非法包标识与路径穿越", () => {
      assert.throws(() => normalizeServerViews({ packageAllowlist: [""] }));
      assert.throws(() => normalizeServerViews({ packageAllowlist: ["   "] }));
      assert.throws(() => normalizeServerViews({ packageAllowlist: ["../evil"] }));
    });

    it("动作白名单拒绝短名、通配符与畸形引用", () => {
      // 短名引用不是全限定引用
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["read"] }));
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["calc"] }));
      // 通配符仅在 packageAllowlist 中支持独立 *，动作列表不接受任何通配形态
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["*"] }));
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["pkg.a/*"] }));
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["pkg.*/read"] }));
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["pkg.a/ca*lc"] }));
      // 畸形引用
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["pkg.a/"] }));
      assert.throws(() => normalizeServerViews({ actionAllowlist: ["/read"] }));
    });

    it("packageAllowlist 中除独立 * 外不接受通配写法", () => {
      assert.throws(() => normalizeServerViews({ packageAllowlist: ["pkg.*"] }));
      assert.throws(() => normalizeServerViews({ packageAllowlist: ["*a"] }));
    });

    it("错误信息携带配置路径便于定位", () => {
      try {
        normalizeServerViews({
          views: {
            agent: { token: "t", actionAllowlist: ["short-name"] },
          },
        });
        assert.fail("should throw");
      } catch (err: any) {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("agent"), `expected view name in message: ${err.message}`);
        assert.ok(err.message.includes("actionAllowlist"), `expected field in message: ${err.message}`);
      }
    });
  });

  describe("normalizeServerViews 装载与视图身份归一化", () => {
    it("正确装载默认视图与命名视图的两类白名单", () => {
      const { defaultView, views } = normalizeServerViews({
        token: "global-token",
        packageAllowlist: ["pkg.global"],
        views: {
          agent: {
            token: "agent-token",
            packageAllowlist: ["pkg.a"],
            actionAllowlist: ["pkg.b/read"],
          },
        },
      });

      assert.strictEqual(defaultView.name, "default");
      assert.deepStrictEqual(defaultView.policy.packageAllowlist, ["pkg.global"]);

      const agentView = views.get("agent")!;
      assert.strictEqual(agentView.policy.viewName, "agent");
      assert.strictEqual(agentView.policy.token, "agent-token");
      assert.deepStrictEqual(agentView.policy.packageAllowlist, ["pkg.a"]);
      assert.deepStrictEqual(agentView.policy.actionAllowlist, ["pkg.b/read"]);
    });

    it("default 与命名视图同语义：显式覆盖 default 视图同样经归一化校验", () => {
      const { defaultView, views } = normalizeServerViews({
        views: [
          {
            name: "default",
            token: "overridden-default-token",
            packageAllowlist: ["pkg.common"],
          },
          {
            name: "worker",
            token: "worker-token",
            actionAllowlist: ["pkg.worker/job"],
          },
        ],
      });

      assert.strictEqual(defaultView.policy.token, "overridden-default-token");
      assert.deepStrictEqual(defaultView.policy.packageAllowlist, ["pkg.common"]);
      assert.deepStrictEqual(views.get("worker")?.policy.actionAllowlist, ["pkg.worker/job"]);

      // default 视图同样拒绝非法动作引用，不存在绕过校验的旧语义
      assert.throws(() =>
        normalizeServerViews({
          views: [{ name: "default", actionAllowlist: ["run-job"] }],
        })
      );
    });

    it("未配置任何白名单时默认视图仍为默认拒绝策略", () => {
      const { defaultView } = normalizeServerViews({ token: "t" });
      assert.strictEqual(defaultView.policy.packageAllowlist, undefined);
      assert.strictEqual(defaultView.policy.actionAllowlist, undefined);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, defaultView.policy), false);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.a", defaultView.policy), false);
    });
  });

  describe("动作判定并集矩阵", () => {
    it("整包授权覆盖包内全部动作", () => {
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, unionPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "write" }, unionPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy("pkg.a/anything", unionPolicy), true);
    });

    it("单动作授权仅命中全限定精确引用", () => {
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, unionPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy("pkg.b/read", unionPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "write" }, unionPolicy), false);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.c", actionId: "read" }, unionPolicy), false);
      assert.strictEqual(isActionAllowedByPolicy("pkg.c/read", unionPolicy), false);
    });

    it("只有单动作授权与只有整包授权均正确", () => {
      const actionsOnly = { actionAllowlist: ["pkg.b/read"] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, actionsOnly), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "write" }, actionsOnly), false);

      const packagesOnly = { packageAllowlist: ["pkg.a"] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "write" }, packagesOnly), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, packagesOnly), false);
    });

    it("省略或空数组零授权：另一项白名单仍独立生效", () => {
      // packageAllowlist 省略时不影响动作白名单授权
      const noPackages = { actionAllowlist: ["pkg.b/read"] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, noPackages), true);

      // packageAllowlist 为空数组同样不增加授权，动作白名单继续生效
      const emptyPackages = { packageAllowlist: [], actionAllowlist: ["pkg.b/read"] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, emptyPackages), true);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.b", emptyPackages), false);

      // actionAllowlist 为空数组时不增加授权，包白名单继续生效
      const emptyActions = { packageAllowlist: ["pkg.a"], actionAllowlist: [] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, emptyActions), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.b", actionId: "read" }, emptyActions), false);
    });

    it("双空与空对象显式拒绝一切动作与包能力", () => {
      const bothEmpty = { packageAllowlist: [], actionAllowlist: [] };
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, bothEmpty), false);
      assert.strictEqual(isActionAllowedByPolicy("pkg.a/read", bothEmpty), false);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.a", bothEmpty), false);
      assert.strictEqual(isPackageVisibleByPolicy("pkg.a", bothEmpty), false);
      assert.strictEqual(isFullAccessGranted(bothEmpty), false);

      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, {}), false);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.a", {}), false);
      assert.strictEqual(isPackageVisibleByPolicy("pkg.a", {}), false);
      assert.strictEqual(isFullAccessGranted({}), false);
    });

    it("packageAllowlist: [\"*\"] 是唯一显式全量标记", () => {
      const starPolicy = { packageAllowlist: ["*"] };
      assert.strictEqual(isFullAccessGranted(starPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "any.pkg", actionId: "thing" }, starPolicy), true);
      assert.strictEqual(isActionAllowedByPolicy({ packageId: "pkg.a", actionId: "read" }, starPolicy), true);
      assert.strictEqual(isPackageAllowedByPolicy("any.pkg", starPolicy), true);
      // * 不替代独立的管理能力门禁
      assert.strictEqual(isManagementAllowedByPolicy(starPolicy), false);
      assert.strictEqual(isManagementAllowedByPolicy({ packageAllowlist: ["*"], enableManagement: true }), true);

      // 一般通配写法在启动校验即拒绝，* 必须独立成项
      assert.throws(() => normalizeServerViews({ packageAllowlist: ["*", "pkg.a*"] }));
    });

    it("未知所属包与缺失标识不放行", () => {
      // 无所属包的短名动作无法构成完整引用，拒绝
      assert.strictEqual(isActionAllowedByPolicy({ actionId: "read" }, unionPolicy), false);
      assert.strictEqual(isActionAllowedByPolicy({ actionId: "read", id: "read" }, unionPolicy), false);
      assert.strictEqual(isActionAllowed("read", unionPolicy.actionAllowlist), false);
      // 全限定引用与包白名单中不存在的包拒绝
      assert.strictEqual(isActionAllowedByPolicy("pkg.unknown/read", unionPolicy), false);
    });

    it("isActionAllowed 严格匹配全限定动作列表，缺省或空列表返回 false", () => {
      const allowlist = ["pkg.b/read", "pkg.a/write"];
      assert.strictEqual(isActionAllowed("pkg.b/read", allowlist), true);
      assert.strictEqual(isActionAllowed({ packageId: "pkg.a", actionId: "write" }, allowlist), true);
      assert.strictEqual(isActionAllowed("pkg.b/write", allowlist), false);
      assert.strictEqual(isActionAllowed("pkg.b/read", undefined), false);
      assert.strictEqual(isActionAllowed("pkg.b/read", []), false);
      // 短名目标在严格全限定匹配下始终未命中
      assert.strictEqual(isActionAllowed("read", allowlist), false);
    });

    it("管理模式独立：全量包授权不自动开启管理", () => {
      assert.strictEqual(isManagementAllowedByPolicy(unionPolicy), false);
      assert.strictEqual(isManagementAllowedByPolicy({ ...unionPolicy, enableManagement: true }), true);
      assert.strictEqual(isManagementAllowedByPolicy(undefined), false);
    });
  });

  describe("包能力授权与发现可见性区分", () => {
    it("isPackageAllowedByPolicy 仅整包能力授权为真，单动作授权不推导整包能力", () => {
      assert.strictEqual(isPackageAllowedByPolicy("pkg.a", unionPolicy), true);
      assert.strictEqual(isPackageAllowedByPolicy("pkg.b", unionPolicy), false);
      assert.strictEqual(isPackageAllowedByPolicy(undefined, unionPolicy), false);
    });

    it("isPackageVisibleByPolicy 对单动作授权包返回可见", () => {
      assert.strictEqual(isPackageVisibleByPolicy("pkg.a", unionPolicy), true);
      assert.strictEqual(isPackageVisibleByPolicy("pkg.b", unionPolicy), true);
      assert.strictEqual(isPackageVisibleByPolicy("pkg.c", unionPolicy), false);
      assert.strictEqual(isPackageVisibleByPolicy(undefined, unionPolicy), false);
    });

    it("requiresMinimalPackageProjection 仅对单动作授权包为真", () => {
      assert.strictEqual(requiresMinimalPackageProjection("pkg.a", unionPolicy), false);
      assert.strictEqual(requiresMinimalPackageProjection("pkg.b", unionPolicy), true);
      assert.strictEqual(requiresMinimalPackageProjection("pkg.c", unionPolicy), false);
      assert.strictEqual(requiresMinimalPackageProjection("pkg.b", { packageAllowlist: ["*"] }), false);
      assert.strictEqual(requiresMinimalPackageProjection("pkg.b", undefined), false);
    });
  });

  describe("过滤函数行为", () => {
    const actions = [
      { id: "pkg.a/read", packageId: "pkg.a", actionId: "read" },
      { id: "pkg.a/write", packageId: "pkg.a", actionId: "write" },
      { id: "pkg.b/read", packageId: "pkg.b", actionId: "read" },
      { id: "pkg.b/write", packageId: "pkg.b", actionId: "write" },
      { id: "pkg.c/read", packageId: "pkg.c", actionId: "read" },
    ];
    const packages = [{ id: "pkg.a" }, { id: "pkg.b" }, { id: "pkg.c" }];

    it("filterActionsByPolicy 按整包与单动作授权并集过滤", () => {
      const filtered = filterActionsByPolicy(actions, unionPolicy);
      assert.deepStrictEqual(filtered.map((a) => a.id), ["pkg.a/read", "pkg.a/write", "pkg.b/read"]);
    });

    it("filterPackagesByPolicy 保留整包授权与单动作授权包", () => {
      const filtered = filterPackagesByPolicy(packages, unionPolicy);
      assert.deepStrictEqual(filtered.map((p) => p.id), ["pkg.a", "pkg.b"]);
    });

    it("空授权过滤为空集合而非全放行", () => {
      assert.deepStrictEqual(filterActionsByPolicy(actions, { packageAllowlist: [], actionAllowlist: [] }), []);
      assert.deepStrictEqual(filterPackagesByPolicy(packages, { packageAllowlist: [], actionAllowlist: [] }), []);
      assert.deepStrictEqual(filterActionsByPolicy(actions, {}), []);
      assert.deepStrictEqual(filterPackagesByPolicy(packages, {}), []);
    });

    it("不传策略的内部纯函数调用不执行过滤", () => {
      assert.deepStrictEqual(filterActionsByPolicy(actions, undefined), actions);
      assert.deepStrictEqual(filterPackagesByPolicy(packages, undefined), packages);
    });
  });
});
