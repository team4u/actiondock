# Agent Notes - ActionDock 2.0

- ActionDock 2.0 is a Bun + TypeScript toolchain for developing, testing, building, and exporting standalone AI Agent Actions and Skills.
- Runtime / Engine: Bun (TypeScript native, Bun.build standalone compiler, bun:sqlite).
- Monorepo structure:
  - `packages/sdk`: `@actiondock/sdk` (minimal public SDK: `defineAction`, `ActionContext`, `Config`, `StateStore`, `ActionInvoker`, `Logger`, `createTestRuntime`)
  - `packages/core`: `@actiondock/core` (core domain engine: `project`, `runtime`, `storage`, `schema`, `build`, `export`, `standalone`)
  - `packages/cli`: `@actiondock/cli` (CLI facade toolchain: `init`, `info`, `action`, `playbook`, `config`, `state`, `runs`, `test`, `build`, `export skill`)
  - `examples/*`: Example actiondock action packages
- Validation commands:
  - Run all tests: `bun test`
  - Run typecheck: `bun run typecheck`
- Standalone Contract:
  - In dev run (`ActionRunner`) and compiled standalone executable, ActionContext semantics and JSON envelope format must remain strictly identical.
