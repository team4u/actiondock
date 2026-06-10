export const SKIP_NEW_VERSION_CHECK_ENV = "ACTIONDOCK_SKIP_NEW_VERSION_CHECK";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isTruthyEnvValue(value) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

export function hasExplicitSkipNewVersionCheck(env = process.env) {
  return hasOwn(env, SKIP_NEW_VERSION_CHECK_ENV);
}

export function shouldSkipNewVersionCheckByDefault({
  env = process.env,
  stdinIsTTY = Boolean(process.stdin.isTTY),
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  stderrIsTTY = Boolean(process.stderr.isTTY),
} = {}) {
  return isTruthyEnvValue(env.CI) || !stdinIsTTY || !stdoutIsTTY || !stderrIsTTY;
}

export function applyNewVersionCheckEnvironment({
  env = process.env,
  forceSkip = false,
  argv = process.argv,
  stdinIsTTY = Boolean(process.stdin.isTTY),
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  stderrIsTTY = Boolean(process.stderr.isTTY),
} = {}) {
  if (hasExplicitSkipNewVersionCheck(env)) {
    return env;
  }

  if (
    forceSkip
    || shouldSkipNewVersionCheckByDefault({ env, stdinIsTTY, stdoutIsTTY, stderrIsTTY })
  ) {
    env[SKIP_NEW_VERSION_CHECK_ENV] = "1";
  }

  return env;
}
