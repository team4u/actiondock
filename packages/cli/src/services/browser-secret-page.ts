/**
 * HTML 特殊字符转义。
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderBrowserSecretPageOptions {
  targetLabel: string;
  key: string;
  nonce: string;
}

/**
 * 构造紧凑内置的中文敏感配置录入静态页面。
 * 使用一次性 Nonce CSP，无外部资源依赖，不回显历史旧值。
 */
export function renderBrowserSecretPage(options: RenderBrowserSecretPageOptions): string {
  const safeTarget = escapeHtml(options.targetLabel);
  const safeKey = escapeHtml(options.key);
  const safeNonce = escapeHtml(options.nonce);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ActionDock 敏感配置录入</title>
  <style nonce="${safeNonce}">
    :root {
      --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc;
      --muted: #94a3b8; --primary: #2563eb; --danger: #dc2626; --success: #16a34a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh;
      display: flex; align-items: center; justify-content: center; padding: 1rem;
    }
    .card {
      background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem;
      max-width: 32rem; width: 100%; padding: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    h1, h2 { font-size: 1.15rem; font-weight: 600; margin-bottom: 1rem; }
    .meta {
      background: var(--bg); border: 1px solid var(--border); border-radius: 0.375rem;
      padding: 0.75rem; margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.5;
    }
    .meta-k { color: var(--muted); }
    .meta-v { font-family: monospace; color: #38bdf8; word-break: break-all; }
    .field-header {
      display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.375rem;
    }
    .field-header label { font-size: 0.85rem; margin-bottom: 0; }
    .editor-wrap {
      position: relative; margin-bottom: 1rem;
    }
    textarea {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 0.375rem;
      padding: 0.625rem; color: var(--text); font-family: monospace; font-size: 0.85rem;
      resize: vertical; min-height: 7.5rem; line-height: 1.45; word-break: break-all; display: block;
    }
    textarea.masked {
      -webkit-text-security: disc;
      text-security: disc;
    }
    textarea.masked-fallback {
      color: transparent !important;
      user-select: none !important;
    }
    .mask-overlay {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: var(--card); border: 1px solid var(--border); border-radius: 0.375rem;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--muted); font-size: 0.85rem; cursor: pointer; padding: 0.75rem; text-align: center;
    }
    .mask-overlay.hidden { display: none; }
    .mask-overlay-sub { font-size: 0.75rem; margin-top: 0.375rem; color: #38bdf8; }
    button {
      border: none; border-radius: 0.375rem; padding: 0.5rem 0.875rem;
      font-size: 0.85rem; cursor: pointer; font-weight: 500;
    }
    button.toggle { background: var(--border); color: var(--text); }
    .actions { display: flex; gap: 0.5rem; }
    button.submit { flex: 1; background: var(--primary); color: #fff; }
    button.cancel { background: transparent; border: 1px solid var(--border); color: var(--muted); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 0.875rem; font-size: 0.85rem; line-height: 1.4; min-height: 1.25rem; }
    .status.err { color: #f87171; }
    .status.ok { color: #4ade80; }
    .status.info { color: #60a5fa; }
    .tip { color: var(--muted); font-size: 0.85rem; }
    .msg { margin: 0.75rem 0; }
    .footer {
      margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid var(--border);
      font-size: 0.75rem; color: var(--muted); line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card" id="box">
    <h1>ActionDock 敏感配置录入</h1>
    <div class="meta">
      <div><span class="meta-k">保存范围：</span><span class="meta-v">${safeTarget}</span></div>
      <div><span class="meta-k">配置项：</span><span class="meta-v">${safeKey}</span></div>
    </div>
    <form id="form">
      <div>
        <div class="field-header">
          <label for="val">敏感配置值</label>
          <button type="button" class="toggle" id="tog">显示</button>
        </div>
        <div class="editor-wrap">
          <textarea id="val" class="masked" autocomplete="off" spellcheck="false" rows="6" required></textarea>
          <div id="mask" class="mask-overlay hidden" aria-hidden="true">
            <div>已启用敏感配置遮罩保护</div>
            <div class="mask-overlay-sub">点击此处或「显示」切换明文</div>
          </div>
        </div>
      </div>
      <div class="actions">
        <button type="submit" class="submit" id="sub">保存配置</button>
        <button type="button" class="cancel" id="can">取消</button>
      </div>
      <div class="status" id="st"></div>
    </form>
    <div class="footer">
      说明：输入限时 5 分钟。本页面用于避免凭据经命令参数和模型对话传递；配置在本地 SQLite 仍明文存储（无磁盘加密）。支持多行输入，浏览器将换行统一为 LF。临时链接不可分享；已授权 Action 及本机程序不受此隔离。
    </div>
  </div>
  <script nonce="${safeNonce}">
    (function() {
      var h = window.location.hash.slice(1);
      var params = new URLSearchParams(h);
      var ticket = params.get("ticket");
      var input = document.getElementById("val");
      var toggleBtn = document.getElementById("tog");
      var maskOverlay = document.getElementById("mask");
      var submitBtn = document.getElementById("sub");
      var cancelBtn = document.getElementById("can");
      var status = document.getElementById("st");
      var box = document.getElementById("box");

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }

      if (!ticket) {
        status.textContent = "缺少或无效的临时凭据，请重新在终端运行命令。";
        status.className = "status err";
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        return;
      }

      var supportsTextSecurity = !!(window.CSS && typeof CSS.supports === "function" && (CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc")));
      var isMasked = true;

      function updateMask() {
        if (isMasked) {
          toggleBtn.textContent = "显示";
          if (supportsTextSecurity) {
            input.classList.add("masked");
            input.classList.remove("masked-fallback");
            maskOverlay.classList.add("hidden");
          } else {
            input.classList.remove("masked");
            input.classList.add("masked-fallback");
            if (input.value.length > 0) {
              maskOverlay.classList.remove("hidden");
            } else {
              maskOverlay.classList.add("hidden");
            }
          }
        } else {
          toggleBtn.textContent = "隐藏";
          input.classList.remove("masked");
          input.classList.remove("masked-fallback");
          maskOverlay.classList.add("hidden");
        }
      }

      toggleBtn.addEventListener("click", function() {
        isMasked = !isMasked;
        updateMask();
      });

      input.addEventListener("input", function() {
        if (!supportsTextSecurity && isMasked) {
          updateMask();
        }
      });

      maskOverlay.addEventListener("click", function() {
        isMasked = false;
        updateMask();
        input.focus();
      });

      updateMask();

      document.getElementById("form").addEventListener("submit", async function(e) {
        e.preventDefault();
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = "正在保存配置...";
        status.className = "status info";

        try {
          var res = await fetch("/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket: ticket, value: input.value })
          });

          if (res.ok) {
            box.innerHTML = '<h2>配置已更新</h2>' +
              '<p class="status ok msg">敏感配置已成功写入本地存储。</p>' +
              '<p class="tip">现在可以关闭此浏览器标签页。</p>';
          } else if (res.status === 400) {
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            var err = "配置值格式不符合要求，请修正后重试。";
            try {
              var data = await res.json();
              if (data && data.error) err = data.error;
            } catch (_) {}
            status.textContent = err;
            status.className = "status err";
          } else if (res.status === 413) {
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            status.textContent = "配置值体积超出上限（单次最大 64 KiB），请缩减内容后重试或取消。";
            status.className = "status err";
          } else if (res.status === 409) {
            status.textContent = "提交冲突：已有提交正在处理或会话已结束，请查看终端输出。";
            status.className = "status err";
          } else {
            status.textContent = "保存失败，无法确认最终状态，请查看终端输出。";
            status.className = "status err";
          }
        } catch (_) {
          status.textContent = "网络异常，无法确认是否已保存，请检查终端输出。";
          status.className = "status err";
        }
      });

      cancelBtn.addEventListener("click", async function() {
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = "正在请求取消...";
        status.className = "status info";

        try {
          var res = await fetch("/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket: ticket })
          });
          if (res.ok) {
            box.innerHTML = '<h2>已取消</h2>' +
              '<p class="tip msg">配置录入已取消，未修改本地存储。</p>' +
              '<p class="tip">现在可以关闭此标签页。</p>';
          } else {
            status.textContent = "未能确认取消（可能已进入保存阶段或会话已结束），请查看终端实际状态。";
            status.className = "status err";
          }
        } catch (_) {
          status.textContent = "网络连接中断，无法确认取消状态，请查看终端输出。";
          status.className = "status err";
        }
      });
    })();
  </script>
</body>
</html>`;
}
