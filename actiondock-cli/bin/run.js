#!/usr/bin/env node

import { execute } from "@oclif/core";
import { applyNewVersionCheckEnvironment } from "./update-env.js";

applyNewVersionCheckEnvironment();
await execute({ dir: import.meta.url });
