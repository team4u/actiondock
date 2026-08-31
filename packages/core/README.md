# @actiondock/core

The core engine of ActionDock 2.0.

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.1-black?logo=bun)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@actiondock/core` contains the project loader, runtime execution engine (`ActionRunner`), native SQLite persistence, standalone binary compiler, remote HTTP server/client, and Agent Skill exporter.

---

## Installation

```bash
bun add @actiondock/core
# or
npm install @actiondock/core
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

- [Runtime Architecture](https://github.com/team4u/actiondock/blob/main/docs/architecture/runtime.md)
- [Storage & Persistence Guide](https://github.com/team4u/actiondock/blob/main/docs/guides/storage.md)
- [Standalone Binary Build](https://github.com/team4u/actiondock/blob/main/docs/guides/standalone-build.md)
- [HTTP Server & Remote Dispatch](https://github.com/team4u/actiondock/blob/main/docs/guides/http-server.md)

---

## License

[Apache-2.0](LICENSE) © team4u
