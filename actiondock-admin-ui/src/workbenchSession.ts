function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    ) as T;
  }
  return value;
}

export interface WorkbenchScriptPatchApplication {
  scriptId: string;
  patch?: string;
  updatedSource: string;
  rationale?: string;
}

export interface WorkbenchSchemaPatchApplication {
  scriptId: string;
  inputSchemaPatch?: Record<string, unknown>;
  outputSchemaPatch?: Record<string, unknown>;
  rationale?: string;
}

export interface WorkbenchReleaseNotesDraft {
  scriptId: string;
  notes: string;
}

export interface WorkbenchExecutionPrefill {
  scriptId: string;
  input: Record<string, unknown>;
  sourceLabel?: string;
}

const SCRIPT_PATCH_KEY = "actiondock.workbench.scriptPatch";
const SCHEMA_PATCH_KEY = "actiondock.workbench.schemaPatch";
const RELEASE_NOTES_KEY = "actiondock.workbench.releaseNotes";
const EXECUTION_PREFILL_KEY = "actiondock.workbench.executionPrefill";

function writePayload<T>(key: string, payload: T): void {
  sessionStorage.setItem(key, JSON.stringify(payload));
}

function readPayload<T>(key: string): T | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clearPayload(key: string): void {
  sessionStorage.removeItem(key);
}

export function saveWorkbenchScriptPatchApplication(payload: WorkbenchScriptPatchApplication): void {
  writePayload(SCRIPT_PATCH_KEY, payload);
}

export function readWorkbenchScriptPatchApplication(): WorkbenchScriptPatchApplication | null {
  return readPayload<WorkbenchScriptPatchApplication>(SCRIPT_PATCH_KEY);
}

export function clearWorkbenchScriptPatchApplication(): void {
  clearPayload(SCRIPT_PATCH_KEY);
}

export function saveWorkbenchSchemaPatchApplication(payload: WorkbenchSchemaPatchApplication): void {
  writePayload(SCHEMA_PATCH_KEY, payload);
}

export function readWorkbenchSchemaPatchApplication(): WorkbenchSchemaPatchApplication | null {
  return readPayload<WorkbenchSchemaPatchApplication>(SCHEMA_PATCH_KEY);
}

export function clearWorkbenchSchemaPatchApplication(): void {
  clearPayload(SCHEMA_PATCH_KEY);
}

export function saveWorkbenchReleaseNotesDraft(payload: WorkbenchReleaseNotesDraft): void {
  writePayload(RELEASE_NOTES_KEY, payload);
}

export function readWorkbenchReleaseNotesDraft(): WorkbenchReleaseNotesDraft | null {
  return readPayload<WorkbenchReleaseNotesDraft>(RELEASE_NOTES_KEY);
}

export function clearWorkbenchReleaseNotesDraft(): void {
  clearPayload(RELEASE_NOTES_KEY);
}

export function saveWorkbenchExecutionPrefill(payload: WorkbenchExecutionPrefill): void {
  writePayload(EXECUTION_PREFILL_KEY, payload);
}

export function readWorkbenchExecutionPrefill(): WorkbenchExecutionPrefill | null {
  return readPayload<WorkbenchExecutionPrefill>(EXECUTION_PREFILL_KEY);
}

export function clearWorkbenchExecutionPrefill(): void {
  clearPayload(EXECUTION_PREFILL_KEY);
}

export function applyJsonMergePatch<T>(target: T, patch: unknown): T {
  if (!isRecord(patch)) {
    return deepClone(patch as T);
  }

  const source = isRecord(target) ? deepClone(target) : {};
  const result: Record<string, unknown> = { ...source };

  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) {
      delete result[key];
      return;
    }
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = applyJsonMergePatch(result[key], value);
      return;
    }
    result[key] = deepClone(value);
  });

  return result as T;
}
