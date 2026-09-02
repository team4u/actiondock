# @actiondock/mcp

Model Context Protocol (MCP) adapter for ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Runtime requirement**: [Bun](https://bun.sh/) >= 1.2.0 is required.

`@actiondock/mcp` connects ActionDock Actions directly to the Model Context Protocol (MCP), exposing Actions as fully-typed MCP Tools over STDIO and HTTP transports.

---

## Installation

```bash
bun add @actiondock/mcp
# or
npm install @actiondock/mcp
```

---

## Features

- **STDIO & HTTP Transport**: Run locally via STDIO (for Claude Code, Cursor, Windsurf) or over HTTP with authentication and CORS.
- **Dynamic Tool Mapping**: Automatically converts Action `inputSchema` / `outputSchema` into standard MCP Tool contracts.
- **Cancellation Propagation**: Propagates MCP client cancellations directly to `ctx.signal` (`AbortSignal`).
- **Tasks Extension**: Supports asynchronous background tool calls via MCP Tasks extension (`tasks/get`, `tasks/cancel`, `tasks/list`).

---

## 📖 Documentation

- [MCP Integration Guide](../../docs/consumer/use-as-mcp.md)
- [Action API Reference](../../docs/reference/action-api.md)

---

## License

[Apache-2.0](../../LICENSE) © team4u
