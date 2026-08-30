# 多环境与远程云机器调度指南 (Profiles & Remote Runner)

在 ActionDock 2.0 中，你可以通过 **Profile（环境配置）** 与 **`ac serve`（轻量 HTTP Runner）** 机制，在本地 CLI 或 AI Agent 中无缝调度分布在不同云厂商（如阿里云、AWS、腾讯云等）或本地网络中的云主机与环境。

---

## 核心架构原理

```text
       本地开发机 / AI Agent                           远端云主机 (阿里云 / AWS / 等)
  ┌───────────────────────────────┐                  ┌───────────────────────────────┐
  │                               │                  │                               │
  │  ac run clean-logs            │  HTTP POST /run  │  ac serve --port 5177         │
  │    --profile aliyun-prod      │ ───────────────► │    ├── 极轻量 Bun 原生 HTTP   │
  │                               │ (Bearer Token)   │    ├── 读取本地 Action 代码   │
  │                               │                  │    └── 执行并返回结果         │
  │  stdout: 标准 JSON 结果       │ ◄─────────────── │                               │
  │  { "ok": true, "data": ... }  │  JSON Envelope   │                               │
  └───────────────────────────────┘                  └───────────────────────────────┘
```

---

## 快速上手步骤

### 第一步：在远端云机器上启动服务 (`ac serve`)

登录到你的云服务器（需要已安装 ActionDock CLI `ac`），进入 Action 项目目录（或注册了全局包的环境），启动服务：

```bash
# 启动 HTTP Runner（默认安全绑定 127.0.0.1）
ac serve --port 5177 --token my-secret-token-12345

# 暴露给局域网或公网网卡（0.0.0.0 强制要求配置 Token，或传入 --allow-insecure-no-auth）
ac serve --host 0.0.0.0 --port 5177 --token my-secret-token-12345 --cors-origin http://localhost:3000 --max-body 1mb
```

控制台会显示服务已就绪：
```text
======================================================
  ActionDock 2.0 HTTP Runner Server
======================================================
  * Listening on:    http://127.0.0.1:5177
  * Project:         My Cloud Ops (org.cloud-ops)
  * Authentication:  Bearer Token / Query Token Enabled
  * CORS Origins:    Disabled (Default)
  * Max Body Size:   1mb
  * Health Endpoint: http://127.0.0.1:5177/api/v1/health
======================================================
```

---

### 第二步：在本地配置 Profile (`ac profile add`)

在本地机器上，使用 `ac profile add` 命令将远端云机器注册为一个命名 Profile。**推荐使用 `--token-env` 关联环境变量名**，避免明文持久化 Token：

```bash
# 1. 推荐：通过环境变量管理 Token
export ACTIONDOCK_ALIYUN_PROD_TOKEN=my-secret-token-12345
ac profile add aliyun-prod \
  --server http://114.115.116.117:5177 \
  --token-env ACTIONDOCK_ALIYUN_PROD_TOKEN \
  --desc "阿里云华东生产机器"

# 2. 或直接依赖标准命名推导规则（无需显式配置 tokenEnv）：
# 若 Profile 名为 aws-test，ActionDock 会自动查找环境变量 ACTIONDOCK_AWS_TEST_TOKEN 或 AWS_TEST_TOKEN
export ACTIONDOCK_AWS_TEST_TOKEN=aws-secret-token
ac profile add aws-test \
  --server https://aws-runner.example.com \
  --desc "AWS 美西测试节点"
```

> **安全提示**：配置文件 `~/.actiondock/profiles.json` 会自动应用 POSIX `0o600` 文件权限与 `0o700` 目录权限保护。

---

### 第三步：测试连通性与查看状态

```bash
# 列出所有配置的 profile（默认掩码脱敏并标注 Token 来源）
ac profile list

# 查看包含明文 Token 的详情
ac profile list --reveal
ac profile show aliyun-prod --reveal

# 测试与阿里云节点的连接延迟和健康状态
ac profile test aliyun-prod
```

输出示例：
```text
[OK] Connected to http://114.115.116.117:5177 (28ms) - Version: 2.0.0, Status: ok
```

---

### 第四步：调度远端 Action 执行

#### 1. 单次执行时指定 `--profile`
```bash
ac run check-disk --profile aliyun-prod -i '{"mount": "/data"}'
```

#### 2. 查看远端机器上可用的 Action
```bash
ac action list --profile aliyun-prod
```

#### 3. 切换默认 Profile
如果需要一段会话内都针对该云机器执行：
```bash
ac profile use aliyun-prod

# 之后无需每次传 --profile，默认直接发往 aliyun-prod
ac run clean-logs
```

#### 4. 切回本地直接执行
```bash
ac profile use local
```

---

## 优先级与解析规则

当发起 Action 执行或查询时，目标主机的解析优先级由高到低依次为：

1. **CLI 命令行参数**：`--server <url>` 与 `--token <token>`（最高优先级）
2. **CLI 命令行参数**：`--profile <name>`
3. **环境变量**：`ACTIONDOCK_SERVER_URL` 与 `ACTIONDOCK_TOKEN`
4. **环境变量**：`ACTIONDOCK_PROFILE`
5. **当前激活的 Profile**：`~/.actiondock/profiles.json` 中的 `currentProfile`
6. **本地默认执行**（`local`）

### Token 多级解析优先级 (Token Resolution)

在选定 Remote 目标后，Token 按照与 Config 体系相同的 5-tier 多级回退解析：

1. **CLI 显式参数**：`--token <token>`（最高优先级）
2. **Profile 显式绑定的环境变量**：`profile.tokenEnv` 指定的环境变量
3. **按命名空间规范推导的环境变量**：`ACTIONDOCK_<PROFILE>_TOKEN` 或 `<PROFILE>_TOKEN`
4. **Profile 中存储的 Token**：`profile.token`（兼容历史，已弃用）
5. **全局兜底环境变量**：`ACTIONDOCK_TOKEN`

---

## AI Agent 多云协同场景

在导出的 Skill 中，AI Agent 可以通过简单的参数调度不同云端节点：

```text
User: "请帮我检查阿里云机器 A 上的磁盘，并把告警上报给 AWS 机器 B 的监控服务。"
Agent Actions:
1. ac run disk-usage --profile aliyun-app-a
2. ac run send-alert --profile aws-monitor-b -i '{"level": "WARN", "msg": "..."}'
```

输出的格式均为统一的 `{ ok: true, data: { ... } }` JSON Envelope，Agent 无需关心底层网络传输与异构拓扑差异。
