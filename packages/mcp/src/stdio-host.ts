#!/usr/bin/env node
import { serveParentIpc } from "@actiondock/core";
import { resolveTarget } from "./adapter";
import type { ActionDockMcpOptions } from "./types";

try {
  const rawOptions = process.env.ACTIONDOCK_MCP_OPTIONS;
  const options: ActionDockMcpOptions = rawOptions ? JSON.parse(rawOptions) : {};

  const { target } = await resolveTarget(options);
  await serveParentIpc(target);
} catch (err: any) {
  process.stderr.write(`[MCP Host Error] ${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
}
