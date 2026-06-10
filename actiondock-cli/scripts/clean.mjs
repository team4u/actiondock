import { rmSync } from "node:fs";
import { resolve } from "node:path";

for (const dir of ["dist", "runtime", "jdeploy-bundle"]) {
  rmSync(resolve(process.cwd(), dir), { recursive: true, force: true });
}
