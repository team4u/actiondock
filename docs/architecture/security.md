# 底层架构：安全加固与防御模型

ActionDock 2.0 在设计之初将安全性置于首位，构建了多层级纵深防御体系。

---

## 1. 远程服务安全底线

当使用 `ac serve` 或 `ac mcp --port` 启动网络服务时，执行引擎实施以下安全约束：

1. **非回环地址强制 Token 鉴权**：当监听地址为 `0.0.0.0` 或局域网/公网 IP 时，必须配置访问 Token，否则拒绝启动。
2. **防时序攻击验证**：服务端对客户端传入的 Token 采用常数时间比较（Constant-time comparison / `crypto.timingSafeEqual`），防止旁路时序推测攻击。
3. **请求体大小硬上限**：默认限制 HTTP 请求体最大为 10MB，拒绝超大畸形 Payload 导致内存耗尽（返回 `413 Payload Too Large`）。
4. **CORS 严格白名单**：默认关闭跨域共享，仅在显式配置 `corsWhitelist` 时放行指定源。

---

## 2. 本地凭据与存储安全

1. **文件权限保护**：包含敏感远程节点凭证的 `~/.actiondock/profiles.json` 在创建时强制设置 `0o600` 文件权限（仅当前系统用户可读写）。
2. **支持环境变量脱敏**：Profile 支持 `tokenEnv` 配置，支持从环境变量动态解析高权限 Token，避免明文落盘。
3. **存储隔离**：开发态数据库隔离在项目 `.actiondock/` 目录；独立可执行文件状态隔离于用户主目录 `~/.actiondock/data/`。

---

## 3. Schema 注入与原型污染防御

1. **Ajv 严格模式**：所有入参和配置在执行前均经过 Ajv 严格校验，自动过滤原型污染键（如 `__proto__`、`constructor`）。
2. **强类型数据隔离**：ActionContext 仅向 Action 暴露最小必要接口，杜绝跨包越权访问。
