#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const launcher = resolve(__dirname, "..", "jdeploy-bundle", "jdeploy.cjs");

if (!existsSync(launcher)) {
  console.error("Missing jDeploy launcher. Run `npm run prepack` before testing this package locally.");
  process.exit(1);
}

const child = spawn(process.execPath, [launcher, "--actiondock-runtime", ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
