# @actiondock/core

The core engine and domain kernel of ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` provides the project loader, runtime execution engine (`ActionRunner`), native SQLite persistence, standalone binary compiler, remote HTTP server/client, and Agent Skill exporter.

> **Role & Usage Context**:
> - **Authoring Actions**: Use [`@actiondock/sdk`](../sdk) for defining actions, testing with in-memory harness, and zero-dependency action packages.
> - **CLI Toolchain**: Use [`@actiondock/cli`](../cli) (`ad`) for command-line workflows.
> - **Engine & Embedding**: Use `@actiondock/core` when you need programmatic access to the ActionRunner engine, project loader, or custom server integrations.
>
> **Runtime requirement**: [Bun](https://bun.sh/) >= 1.2.0 is required (`@actiondock/core` leverages native `bun:sqlite` and Bun runtime APIs).

---

## Installation

```bash
bun add @actiondock/core
```

---

## Key Modules

- **Project Loader** (`loadProjectConfig`, `loadActions`, `loadPlaybooks`, `initProject`): Discovers and parses Action Packages.
- **Runtime Execution** (`ActionRunner`, `createActionContext`, `createStandaloneRuntime`): Manages the full action execution lifecycle, schema validation, cycle detection, timeouts, and JSON envelopes.
- **Storage** (`SqliteRuntimeStorage`, `createStorage`, `createGlobalStorage`): Native SQLite KV store with namespaces, TTL, and WAL mode.
- **Standalone Builder** (`buildProject`): Uses Bun's native bundler to compile actions into a single standalone binary.
- **Skill Exporter** (`exportSkill`): Generates self-contained Agent Skills with Playbook SOPs.
- **Profile & Remote Runner** (`ProfileManager`, `ActionServer`, `executeRemoteAction`): Multi-cloud remote execution with token authentication.

---

## 📖 Documentation

- [Runtime Architecture](../../docs/architecture/runtime.md)
- [Storage & Persistence Guide](../../docs/developer/storage.md)
- [Standalone Binary Build](../../docs/developer/build-and-export.md)
- [HTTP Server & Remote Dispatch](../../docs/consumer/http-service.md)

---

## License

[Apache-2.0](../../LICENSE) © team4u
