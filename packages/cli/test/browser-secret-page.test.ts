import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { renderBrowserSecretPage, escapeHtml } from "../src/services/browser-secret-page";

interface MockElement {
  id?: string;
  tagName: string;
  type?: string;
  value?: string;
  textContent: string;
  className: string;
  classList: {
    add(cls: string): void;
    remove(cls: string): void;
    contains(cls: string): boolean;
    toggle(cls: string): boolean;
  };
  disabled?: boolean;
  innerHTML: string;
  listeners: Record<string, ((e?: any) => Promise<void> | void)[]>;
  addEventListener(event: string, handler: (e?: any) => Promise<void> | void): void;
  dispatchEvent(event: { type: string; preventDefault?: () => void }): Promise<void>;
  focus(): void;
}

function createMockElement(id: string, tagName: string): MockElement {
  const classes = new Set<string>();
  const listeners: Record<string, ((e?: any) => Promise<void> | void)[]> = {};

  const el: MockElement = {
    id,
    tagName,
    textContent: "",
    className: "",
    classList: {
      add(cls: string) {
        classes.add(cls);
        el.className = Array.from(classes).join(" ");
      },
      remove(cls: string) {
        classes.delete(cls);
        el.className = Array.from(classes).join(" ");
      },
      contains(cls: string) {
        return classes.has(cls);
      },
      toggle(cls: string) {
        if (classes.has(cls)) {
          classes.delete(cls);
        } else {
          classes.add(cls);
        }
        el.className = Array.from(classes).join(" ");
        return classes.has(cls);
      },
    },
    disabled: false,
    value: "",
    innerHTML: "",
    listeners,
    addEventListener(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    },
    async dispatchEvent(event) {
      const handlers = listeners[event.type] || [];
      for (const h of handlers) {
        await h(event);
      }
    },
    focus() {},
  };

  return el;
}

function extractScript(html: string): string {
  const match = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("No script block found in rendered HTML");
  return match[1];
}

interface SandboxOptions {
  ticket?: string;
  supportsTextSecurity?: boolean;
  fetchHandler?: (url: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
  }>;
}

function runPageScript(html: string, options: SandboxOptions = {}) {
  const scriptContent = extractScript(html);

  const elements: Record<string, MockElement> = {
    box: createMockElement("box", "div"),
    form: createMockElement("form", "form"),
    val: createMockElement("val", "textarea"),
    tog: createMockElement("tog", "button"),
    mask: createMockElement("mask", "div"),
    sub: createMockElement("sub", "button"),
    can: createMockElement("can", "button"),
    st: createMockElement("st", "div"),
  };

  elements.val.classList.add("masked");
  elements.mask.classList.add("hidden");

  const ticketParam = options.ticket !== undefined ? options.ticket : "valid-ticket-123";
  const hash = ticketParam ? `#ticket=${ticketParam}` : "";

  const sandbox: Record<string, any> = {
    window: {
      location: {
        hash,
        pathname: "/",
      },
      history: {
        replaceState() {},
      },
      CSS: {
        supports(prop: string, val: string) {
          if (options.supportsTextSecurity === false) return false;
          return (
            (prop === "-webkit-text-security" || prop === "text-security") &&
            val === "disc"
          );
        },
      },
    },
    CSS: {
      supports(prop: string, val: string) {
        if (options.supportsTextSecurity === false) return false;
        return (
          (prop === "-webkit-text-security" || prop === "text-security") &&
          val === "disc"
        );
      },
    },
    URLSearchParams,
    document: {
      getElementById(id: string) {
        return elements[id] || null;
      },
    },
    fetch: options.fetchHandler || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
  };

  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;

  const context = vm.createContext(sandbox);
  vm.runInContext(scriptContent, context);

  return { elements, sandbox };
}

describe("敏感配置浏览器录入页面脚本行为与状态机测试", () => {
  const baseHtml = renderBrowserSecretPage({
    targetLabel: "test-package",
    key: "PRIVATE_KEY_PEM",
    nonce: "test-nonce-123",
  });

  it("基本结构校验：包含 textarea 与关键显隐及遮罩控件", () => {
    assert.ok(baseHtml.includes("<textarea id=\"val\" class=\"masked\""));
    assert.ok(baseHtml.includes("<div id=\"mask\" class=\"mask-overlay hidden\""));
    assert.ok(baseHtml.includes("<button type=\"button\" class=\"toggle\" id=\"tog\">显示</button>"));
  });

  it("显隐切换 (Toggle) 绝不篡改 textarea.value 原始值", async () => {
    const { elements } = runPageScript(baseHtml);
    const textarea = elements.val;
    const toggleBtn = elements.tog;

    const rawMultilineSecret = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    textarea.value = rawMultilineSecret;

    // 默认初始状态为隐藏
    assert.strictEqual(toggleBtn.textContent, "显示");
    assert.strictEqual(textarea.classList.contains("masked"), true);

    // 第一次点击：切换为显示明文
    await toggleBtn.dispatchEvent({ type: "click" });
    assert.strictEqual(toggleBtn.textContent, "隐藏");
    assert.strictEqual(textarea.classList.contains("masked"), false);
    assert.strictEqual(textarea.value, rawMultilineSecret);

    // 第二次点击：重新切换为隐藏
    await toggleBtn.dispatchEvent({ type: "click" });
    assert.strictEqual(toggleBtn.textContent, "显示");
    assert.strictEqual(textarea.classList.contains("masked"), true);
    assert.strictEqual(textarea.value, rawMultilineSecret);
  });

  it("无原生 text-security 支持时回退安全遮罩与透明样式，不暴露明文", async () => {
    const { elements } = runPageScript(baseHtml, { supportsTextSecurity: false });
    const textarea = elements.val;
    const toggleBtn = elements.tog;
    const maskOverlay = elements.mask;

    // 初始状态应激活回退样式，且由于尚未录入内容遮罩保持 hidden
    assert.strictEqual(textarea.classList.contains("masked-fallback"), true);
    assert.strictEqual(maskOverlay.classList.contains("hidden"), true);

    // 模拟录入内容触发 input 事件
    textarea.value = "my-super-secret-key";
    await textarea.dispatchEvent({ type: "input" });

    // 必须出现遮罩，且文本区域为透明 masked-fallback 类
    assert.strictEqual(maskOverlay.classList.contains("hidden"), false);
    assert.strictEqual(textarea.classList.contains("masked-fallback"), true);

    // 点击遮罩本身或显示按钮切换为明文，遮罩隐藏
    await maskOverlay.dispatchEvent({ type: "click" });
    assert.strictEqual(toggleBtn.textContent, "隐藏");
    assert.strictEqual(maskOverlay.classList.contains("hidden"), true);
    assert.strictEqual(textarea.classList.contains("masked-fallback"), false);
    assert.strictEqual(textarea.value, "my-super-secret-key");
  });

  it("提交遇到 413 时：按钮恢复启用、明确提示 64 KiB 上限、且支持缩减后重试保存", async () => {
    let submitCount = 0;
    const { elements } = runPageScript(baseHtml, {
      fetchHandler: async (url, init) => {
        if (url === "/submit") {
          submitCount++;
          if (submitCount === 1) {
            return { ok: false, status: 413, json: async () => ({}) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
    });

    const form = elements.form;
    const textarea = elements.val;
    const submitBtn = elements.sub;
    const cancelBtn = elements.can;
    const status = elements.st;
    const box = elements.box;

    textarea.value = "A".repeat(70000);

    // 第一次提交（模拟超大 payload 触发 413）
    let defaultPrevented = false;
    await form.dispatchEvent({
      type: "submit",
      preventDefault() {
        defaultPrevented = true;
      },
    });

    assert.strictEqual(defaultPrevented, true);
    assert.strictEqual(submitBtn.disabled, false);
    assert.strictEqual(cancelBtn.disabled, false);
    assert.ok(status.textContent.includes("64 KiB"));
    assert.strictEqual(status.className, "status err");

    // 缩减输入后重试提交成功
    textarea.value = "valid-length-secret";
    await form.dispatchEvent({
      type: "submit",
      preventDefault() {},
    });

    assert.strictEqual(submitCount, 2);
    assert.ok(box.innerHTML?.includes("配置已更新"));
  });

  it("提交遇到 413 后：支持页面直接点击取消", async () => {
    let cancelCalled = false;
    const { elements } = runPageScript(baseHtml, {
      fetchHandler: async (url) => {
        if (url === "/submit") {
          return { ok: false, status: 413, json: async () => ({}) };
        }
        if (url === "/cancel") {
          cancelCalled = true;
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
    });

    const form = elements.form;
    const cancelBtn = elements.can;
    const box = elements.box;

    // 触发 413
    await form.dispatchEvent({ type: "submit", preventDefault() {} });
    assert.strictEqual(cancelBtn.disabled, false);

    // 点击取消
    await cancelBtn.dispatchEvent({ type: "click" });
    assert.strictEqual(cancelCalled, true);
    assert.ok(box.innerHTML?.includes("已取消"));
  });

  it("未知 500 异常或网络中断时：不得盲目恢复重试，按钮保持禁用", async () => {
    const { elements } = runPageScript(baseHtml, {
      fetchHandler: async () => {
        return { ok: false, status: 500, json: async () => ({ error: "Internal Error" }) };
      },
    });

    await elements.form.dispatchEvent({ type: "submit", preventDefault() {} });
    assert.strictEqual(elements.sub.disabled, true);
    assert.strictEqual(elements.can.disabled, true);
    assert.ok(elements.st.textContent.includes("无法确认最终状态"));
  });
});
