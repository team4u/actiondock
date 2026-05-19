import type { ScriptType } from "../../../../shared/types";

export type InstallAction = "install" | "update";
export type AddMode = "LOCKED" | "TRACKED";
export type LocalAssetAction = "add-local" | "update-local";
export type InstallFilter = "ALL" | "INSTALLED" | "NOT_INSTALLED" | "ORPHAN";
export type TrustFilter = "ALL" | "TRUSTED" | "UNTRUSTED";
export type TypeFilter = "ALL" | ScriptType;
