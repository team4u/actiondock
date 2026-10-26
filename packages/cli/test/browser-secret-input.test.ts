import assert from "node:assert/strict";
import { describe, it } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { CONFIG_VALUE_INVALID } from "@actiondock/core";
import {
  launchSystemBrowser,
  promptBrowserSecret,
} from "../src/services/browser-secret-input";
import { ExecutionError, SigintError } from "../src/errors";

function extractTicketAndOrigin(url: string): { origin: string; host: string; ticket: string; port: number } {
  const [base, hash] = url.split("#");
  const origin = base.replace(/\/$/, "");
  const host = origin.replace(/^http:\/\//, "");
  const port = Number(host.split(":")[1]);
  const ticket = new URLSearchParams(hash).get("ticket") || "";
  return { origin, host, ticket, port };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRawHttpRequest(
  port: number,
  path: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: body !== undefined ? "POST" : "GET",
        headers,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, text });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

describe("浏览器敏感配置输入底层服务与启动器测试", () => {
  describe("launchSystemBrowser 系统启动器单元测试（可注入边界）", () => {
    it("子进程触发 error 事件时返回 false", async () => {
      const mockSpawn = () => {
        const ee = new EventEmitter() as any;
        ee.unref = () => {};
        process.nextTick(() => ee.emit("error", new Error("ENOENT")));
        return ee;
      };
      const ok = await launchSystemBrowser("http://127.0.0.1:1234/#ticket=abc", mockSpawn as any);
      assert.strictEqual(ok, false);
    });

    it("子进程非零状态码退出时返回 false", async () => {
      const mockSpawn = () => {
        const ee = new EventEmitter() as any;
        ee.unref = () => {};
        process.nextTick(() => ee.emit("exit", 1));
        return ee;
      };
      const ok = await launchSystemBrowser("http://127.0.0.1:1234/#ticket=abc", mockSpawn as any);
      assert.strictEqual(ok, false);
    });

    it("子进程退出码为 0 时返回 true", async () => {
      const mockSpawn = () => {
        const ee = new EventEmitter() as any;
        ee.unref = () => {};
        process.nextTick(() => ee.emit("exit", 0));
        return ee;
      };
      const ok = await launchSystemBrowser("http://127.0.0.1:1234/#ticket=abc", mockSpawn as any);
      assert.strictEqual(ok, true);
    });

    it("子进程未在确认门限内退出时返回 false（安全降级为手动链接）并正确调用 unref", async () => {
      let unrefCalled = false;
      const mockSpawn = () => {
        const ee = new EventEmitter() as any;
        ee.unref = () => {
          unrefCalled = true;
        };
        return ee;
      };
      const ok = await launchSystemBrowser("http://127.0.0.1:1234/#ticket=abc", mockSpawn as any, 30);
      assert.strictEqual(ok, false);
      assert.strictEqual(unrefCalled, true);
    });
  });

  describe("HTTP Helper 回环服务与生命周期测试", () => {
    it("GET 请求正常返回静态 HTML 与严格安全防护响应头 (包含 Nonce CSP)", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "<test-pkg>&id",
        key: "GITHUB_<TOKEN>",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const res = await makeRawHttpRequest(port, "/", { Host: host });
      assert.strictEqual(res.status, 200);
      assert.ok(String(res.headers["content-type"]).includes("text/html"));
      const csp = String(res.headers["content-security-policy"]);
      assert.ok(csp.includes("default-src 'none'"));
      assert.ok(csp.includes("nonce-"));
      assert.ok(!csp.includes("unsafe-inline"));
      assert.ok(String(res.headers["cache-control"]).includes("no-store"));
      assert.strictEqual(res.headers["x-frame-options"], "DENY");
      assert.strictEqual(res.headers["x-content-type-options"], "nosniff");
      assert.strictEqual(res.headers["referrer-policy"], "no-referrer");

      assert.ok(res.text.includes("保存范围："));
      assert.ok(res.text.includes("&lt;test-pkg&gt;&amp;id"));
      assert.ok(res.text.includes("GITHUB_&lt;TOKEN&gt;"));
      assert.ok(!res.text.includes("<test-pkg>&id"));

      // 正常取消退出
      await makeRawHttpRequest(
        port,
        "/cancel",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket })
      );

      await rejectAssertion;
    });

    it("POST /submit 正确提交原始字符串值并完整保留空白与特殊字符", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const rawSecret = "  {\"token\": 123, \"nested\": false}\n\r  ";
      let submittedValue = "";

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async (val: string) => {
          submittedValue = val;
        },
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const res = await makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: rawSecret })
      );

      assert.strictEqual(res.status, 200);
      const data = JSON.parse(res.text);
      assert.strictEqual(data.ok, true);

      await sessionPromise;
      assert.strictEqual(submittedValue, rawSecret);
    });

    it("安全校验：Host 仅允许 127.0.0.1 端口，拒绝 localhost 或外部域名", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // localhost 被拒绝
      const resLocalhost = await makeRawHttpRequest(port, "/", { Host: `localhost:${port}` });
      assert.strictEqual(resLocalhost.status, 400);

      // 外部 Host 被拒绝
      const resAttacker = await makeRawHttpRequest(port, "/", { Host: "attacker.com" });
      assert.strictEqual(resAttacker.status, 400);

      // 取消退出
      await makeRawHttpRequest(
        port,
        "/cancel",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket })
      );

      await rejectAssertion;
    });

    it("安全校验：POST 严格要求 127.0.0.1 端口精确 Origin，拒绝缺失或 localhost", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // 缺失 Origin
      const resNoOrigin = await makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: "v" })
      );
      assert.strictEqual(resNoOrigin.status, 403);

      // localhost Origin
      const resLocalhost = await makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: `http://localhost:${port}`,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: "v" })
      );
      assert.strictEqual(resLocalhost.status, 403);

      // 取消退出
      await makeRawHttpRequest(
        port,
        "/cancel",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket })
      );

      await rejectAssertion;
    });

    it("安全校验：Content-Type 精确匹配 media-type，拒绝 application/jsonp", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const resJsonp = await makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/jsonp",
        },
        JSON.stringify({ ticket, value: "val" })
      );
      assert.strictEqual(resJsonp.status, 415);

      // application/json; charset=utf-8 允许通过并执行取消退出
      const resValid = await makeRawHttpRequest(
        port,
        "/cancel",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json; charset=utf-8",
        },
        JSON.stringify({ ticket })
      );
      assert.strictEqual(resValid.status, 200);

      await rejectAssertion;
    });

    it("安全校验：载荷形状精确白名单校验（拒绝数组、未知字段与非字符串）", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // JSON null 与畸形 JSON 都应立即响应，不能与读取失败哨兵混淆。
      for (const body of ["null", "{", '"text"', "123", "false"]) {
        const invalid = await makeRawHttpRequest(
          port,
          "/submit",
          { Host: host, Origin: origin, "Content-Type": "application/json" },
          body
        );
        assert.strictEqual(invalid.status, 400);
      }

      // 数组载荷
      const resArray = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify([ticket, "value"])
      );
      assert.strictEqual(resArray.status, 400);

      // submit 携带额外 package 字段
      const resExtraSubmit = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "secret", package: "other" })
      );
      assert.strictEqual(resExtraSubmit.status, 400);

      // cancel 携带额外字段
      const resExtraCancel = await makeRawHttpRequest(
        port,
        "/cancel",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, reason: "abort" })
      );
      assert.strictEqual(resExtraCancel.status, 400);

      // 非字符串 value
      const resNonString = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: 12345 })
      );
      assert.strictEqual(resNonString.status, 400);

      // 错误 ticket
      const resBadTicket = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket: "bad-ticket", value: "ok" })
      );
      assert.strictEqual(resBadTicket.status, 403);

      // 取消退出
      await makeRawHttpRequest(
        port,
        "/cancel",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket })
      );

      await rejectAssertion;
    });

    it("请求体超限 64KiB 时真实返回 413 响应并带 Connection: close", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);
      const hugePayload = JSON.stringify({ ticket, value: "x".repeat(65 * 1024) });

      const res = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        hugePayload
      );

      assert.strictEqual(res.status, 413);
      assert.strictEqual(res.headers.connection, "close");

      // 超限断开后新请求服务仍正常可用，完成取消退出
      const resCancel = await makeRawHttpRequest(
        port,
        "/cancel",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket })
      );
      assert.strictEqual(resCancel.status, 200);

      await rejectAssertion;
    });

    it("客户端半截异常断开不会导致服务崩溃或未捕获异常", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {},
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // 发起半截请求并强制销毁
      await new Promise<void>((resolve) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/submit",
          method: "POST",
          headers: { Host: host, Origin: origin, "Content-Type": "application/json" },
        });
        req.on("error", () => resolve());
        req.write("{\"ticket\":\"incomplete");
        process.nextTick(() => {
          req.destroy();
          resolve();
        });
      });

      // 服务仍正常健康，可完成取消退出
      const resCancel = await makeRawHttpRequest(
        port,
        "/cancel",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket })
      );
      assert.strictEqual(resCancel.status, 200);

      await rejectAssertion;
    });

    it("真并发控制与提交点语义：进入保存后排斥重复提交与取消，且外部 abort 不中断在途保存", async (t) => {
      const ready = createDeferred<string>();
      const saveGate = createDeferred<void>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      let saveAttempts = 0;

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {
          saveAttempts++;
          await saveGate.promise;
        },
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // 发起第一个提交（将在 onSubmit 中被 saveGate 挂起）
      const submit1Promise = makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "first-val" })
      );

      // 等待服务进入 SAVING 阶段
      await new Promise((r) => setTimeout(r, 40));

      // 并发发起第二个提交，断言被 409 拦截
      const resConcurrent = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "second-val" })
      );
      assert.strictEqual(resConcurrent.status, 409);

      // 尝试在保存中发送 cancel，断言被 409 拦截
      const resCancel = await makeRawHttpRequest(
        port,
        "/cancel",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket })
      );
      assert.strictEqual(resCancel.status, 409);

      // 触发外部 AbortSignal，提交点规则保证保存中不受外部信号提前打断
      controller.abort();

      // 放行保存完成
      saveGate.resolve();

      const res1 = await submit1Promise;
      assert.strictEqual(res1.status, 200);

      await sessionPromise;
      assert.strictEqual(saveAttempts, 1);
    });

    it("保存阶段不受 5 分钟超时打断（提交点语义）", async () => {
      const ready = createDeferred<string>();
      const saveGate = createDeferred<void>();

      let saveExecuted = false;

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        timeoutMs: 80,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {
          saveExecuted = true;
          await saveGate.promise;
        },
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const submitPromise = makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "timeout-guard-val" })
      );

      // 跨越 80ms 超时时限
      await new Promise((r) => setTimeout(r, 120));

      // 仍在正常等待保存放行
      saveGate.resolve();

      const res = await submitPromise;
      assert.strictEqual(res.status, 200);

      await sessionPromise;
      assert.strictEqual(saveExecuted, true);
    });

    it("保存校验失败 (CONFIG_VALUE_INVALID) 返回 400 并允许用户修正重试", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      let attempts = 0;
      let finalValue = "";

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async (val: string) => {
          attempts++;
          if (attempts === 1) {
            const err = new Error("Validation failed");
            (err as any).code = CONFIG_VALUE_INVALID;
            throw err;
          }
          finalValue = val;
        },
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      // 第一次提交：校验失败
      const res1 = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "invalid-val" })
      );
      assert.strictEqual(res1.status, 400);

      // 第二次提交：修正重试成功
      const res2 = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: "corrected-val" })
      );
      assert.strictEqual(res2.status, 200);

      await sessionPromise;
      assert.strictEqual(attempts, 2);
      assert.strictEqual(finalValue, "corrected-val");
    });

    it("非校验类存储致命异常返回 500 并使会话以 ExecutionError 失败退出", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const secret = "SUPER_SECRET_PAYLOAD_INTERNAL";

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {
          throw new Error(`Database corrupted while writing ${secret}`);
        },
      });
      const rejectAssertion = assert.rejects(sessionPromise, (err) => {
        assert.ok(err instanceof ExecutionError);
        assert.strictEqual((err as ExecutionError).code, "EXECUTION_FAILURE");
        assert.ok(!err.message.includes(secret));
        return true;
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const res = await makeRawHttpRequest(
        port,
        "/submit",
        { Host: host, Origin: origin, "Content-Type": "application/json" },
        JSON.stringify({ ticket, value: secret })
      );

      assert.strictEqual(res.status, 500);
      assert.ok(!res.text.includes(secret));

      // 会话应立即失败退出，而非等到 5 分钟超时
      await rejectAssertion;
    });

    it("opener 挂起不阻塞外部中断信号取消", async () => {
      const controller = new AbortController();

      const sessionPromise = promptBrowserSecret({
        targetLabel: "auth-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: () => new Promise<boolean>(() => {}), // 永不 resolve 的 opener
        onSubmit: async () => {},
      });

      const rejectAssertion = assert.rejects(sessionPromise, (err) => err instanceof SigintError);
      await new Promise((r) => setTimeout(r, 30));
      controller.abort();

      await rejectAssertion;
    });

    it("启动前 signal 已被 abort 时直接同步报错退出", async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () =>
          promptBrowserSecret({
            targetLabel: "auth-pkg",
            key: "SECRET_KEY",
            signal: controller.signal,
            onSubmit: async () => {},
          }),
        (err) => err instanceof SigintError
      );
    });

    it("opener 启动失败或抛错时不阻断服务，用户仍可手动打开链接提交", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      let submittedValue = "";
      const sessionPromise = promptBrowserSecret({
        targetLabel: "test-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          throw new Error("Cannot launch browser");
        },
        onSubmit: async (v) => {
          submittedValue = v;
        },
      });

      const url = await ready.promise;
      const { origin, host, ticket, port } = extractTicketAndOrigin(url);

      const res = await makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: "manual-value-123" })
      );

      assert.strictEqual(res.status, 200);
      await sessionPromise;
      assert.strictEqual(submittedValue, "manual-value-123");
    });

    it("普通 WAITING 超时后以 TIMEOUT 拒绝并清理资源", async (t) => {
      const controller = new AbortController();
      t.after(() => controller.abort());

      const sessionPromise = promptBrowserSecret({
        targetLabel: "test-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 50,
        openBrowser: () => true,
        onSubmit: async () => {},
      });

      await assert.rejects(
        sessionPromise,
        (err: any) => err instanceof ExecutionError && err.code === "TIMEOUT"
      );
    });

    it("生命周期回归：保存阶段触发 signal.abort()，随后抛出 CONFIG_VALUE_INVALID 时立即以 SigintError 结算而非超时", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const saveEntered = createDeferred<void>();
      const allowSaveToFail = createDeferred<void>();

      const sessionPromise = promptBrowserSecret({
        targetLabel: "test-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 10000, // 充足等待时间，验证不会卡到超时
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {
          saveEntered.resolve();
          await allowSaveToFail.promise;
          const err = new Error("Invalid value") as any;
          err.code = CONFIG_VALUE_INVALID;
          throw err;
        },
      });

      const rejectAssertion = assert.rejects(
        sessionPromise,
        (err: any) => err instanceof SigintError && err.code === "SIGINT_INTERRUPTED"
      );

      const url = await ready.promise;
      const { host, origin, ticket, port } = extractTicketAndOrigin(url);

      const postPromise = makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: "invalid-val" })
      );

      // 等待进入 SAVING 阶段
      await saveEntered.promise;

      // 在保存中执行 abort
      controller.abort();

      // 允许 onSubmit 抛出 CONFIG_VALUE_INVALID
      allowSaveToFail.resolve();

      const res = await postPromise;
      assert.strictEqual(res.status, 400);

      // sessionPromise 必须立即结算为 SigintError（退出码 130），决不能等待超时
      await rejectAssertion;
    });

    it("生命周期回归：初始 deadline 固定，若保存阶段结束且校验失败时已超过原始 deadline 则立即以 TIMEOUT 结算", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      const saveEntered = createDeferred<void>();
      const allowSaveToFail = createDeferred<void>();

      const sessionPromise = promptBrowserSecret({
        targetLabel: "test-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 60, // 短超时 60ms
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async () => {
          saveEntered.resolve();
          await allowSaveToFail.promise;
          const err = new Error("Invalid value") as any;
          err.code = CONFIG_VALUE_INVALID;
          throw err;
        },
      });

      const rejectAssertion = assert.rejects(
        sessionPromise,
        (err: any) => err instanceof ExecutionError && err.code === "TIMEOUT"
      );

      const url = await ready.promise;
      const { host, origin, ticket, port } = extractTicketAndOrigin(url);

      const postPromise = makeRawHttpRequest(
        port,
        "/submit",
        {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
        JSON.stringify({ ticket, value: "bad-val" })
      );

      await saveEntered.promise;
      // 保持保存中等待 100ms（此时超过 60ms deadline，但保存中不被计时打断）
      await new Promise((r) => setTimeout(r, 100));

      // 允许校验失败
      allowSaveToFail.resolve();

      const res = await postPromise;
      assert.strictEqual(res.status, 400);

      // 返回 WAITING 时已超 deadline，必须立即以 TIMEOUT 拒绝并清理
      await rejectAssertion;
    });

    it("客户端提交后立即断开连接，服务端不崩溃且保存正常完成与收尾", async (t) => {
      const ready = createDeferred<string>();
      const controller = new AbortController();
      t.after(() => controller.abort());

      let savedValue = "";
      const saveEntered = createDeferred<void>();

      const sessionPromise = promptBrowserSecret({
        targetLabel: "test-pkg",
        key: "SECRET_KEY",
        signal: controller.signal,
        timeoutMs: 3000,
        openBrowser: (url) => {
          ready.resolve(url);
          return true;
        },
        onSubmit: async (v) => {
          savedValue = v;
          saveEntered.resolve();
          await new Promise((r) => setTimeout(r, 20));
        },
      });

      const url = await ready.promise;
      const { host, origin, ticket, port } = extractTicketAndOrigin(url);

      // 客户端发送请求体后在保存期间断开连接
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/submit",
        method: "POST",
        headers: {
          Host: host,
          Origin: origin,
          "Content-Type": "application/json",
        },
      });
      req.on("error", () => {});
      req.write(JSON.stringify({ ticket, value: "immediate-disconnect-value" }));
      req.end();

      await saveEntered.promise;
      req.destroy();

      await sessionPromise;
      assert.strictEqual(savedValue, "immediate-disconnect-value");
    });
  });
});
