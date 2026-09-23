#!/usr/bin/env node
import { serveParentIpc } from "@actiondock/core/server";
import { resolveService } from "./adapter";
import type { ActionDockMcpOptions } from "./types";

try {
  const rawOptions = process.env.ACTIONDOCK_MCP_OPTIONS;
  const options: ActionDockMcpOptions = rawOptions ? JSON.parse(rawOptions) : {};

  const { service } = await resolveService(options);
  await serveParentIpc(service);
} catch (err: any) {
  process.stderr.write(`[MCP Host Error] ${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
}
