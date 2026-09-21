import { createGlobalStorage } from "../../storage";
import { getActionDockHome } from "../../utils";
import type { DoctorCheck } from "../context";

/**
 * 检查全局存储（全局 SQLite 数据库）可写性。
 */
export const checkGlobalStorage: DoctorCheck = {
  id: "storage.global",
  run: async (ctx) => {
    const globalHome = getActionDockHome(ctx.customHome);
    try {
      const globalStorage = createGlobalStorage(ctx.customHome);
      await globalStorage.setConfig("_doctor_probe_", "ok");
      await globalStorage.deleteConfig("_doctor_probe_");
      globalStorage.close();

      ctx.checks.push({
        id: "storage.global",
        category: "storage",
        name: "Global Storage",
        status: "ok",
        message: `Global SQLite database verified at ${globalHome}`,
      });
    } catch (err: any) {
      ctx.checks.push({
        id: "storage.global",
        category: "storage",
        name: "Global Storage",
        status: "error",
        message: `Failed to access global storage: ${err.message}`,
        fix: `Ensure directory '${globalHome}' is writable`,
      });
    }
  },
};
