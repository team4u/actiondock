#!/usr/bin/env node

import { execute } from "@oclif/core";
import { applyNewVersionCheckEnvironment } from "./update-env.js";

applyNewVersionCheckEnvironment({ forceSkip: true });
await execute({ development: true, dir: import.meta.url });
