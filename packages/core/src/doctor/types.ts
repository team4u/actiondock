export type CheckStatus = "ok" | "warn" | "error";

export interface DoctorCheckItem {
  id: string;
  category: "runtime" | "storage" | "registry" | "project";
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  hasProject: boolean;
  projectRoot?: string;
  packageId?: string;
  summary: {
    total: number;
    ok: number;
    warn: number;
    error: number;
  };
  checks: DoctorCheckItem[];
}
