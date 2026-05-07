import { useCallback, useEffect, useState } from "react";
import { createPreset, deletePreset, listPresets, updatePreset } from "../../features/scripts/api";
import type { ExecutionPreset, ExecutionPresetUpsertRequest } from "../../shared/types";

export interface UseExecutionPresetsOptions {
  scriptId: string | undefined | null;
}

export interface UseExecutionPresetsReturn {
  presets: ExecutionPreset[];
  loading: boolean;
  savePreset: (name: string, input: Record<string, unknown>) => Promise<ExecutionPreset | null>;
  updatePresetInput: (presetId: string, input: Record<string, unknown>) => Promise<ExecutionPreset | null>;
  renamePreset: (presetId: string, newName: string) => Promise<ExecutionPreset | null>;
  deletePreset: (presetId: string) => Promise<void>;
  refresh: () => void;
}

function sortPresets(records: ExecutionPreset[]): ExecutionPreset[] {
  return [...records].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

export function useExecutionPresets({ scriptId }: UseExecutionPresetsOptions): UseExecutionPresetsReturn {
  const [presets, setPresets] = useState<ExecutionPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!scriptId) {
      setPresets([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listPresets(scriptId);
      setPresets(sortPresets(data));
    } catch {
      setPresets([]);
    } finally {
      setLoading(false);
    }
  }, [scriptId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePreset = useCallback(async (name: string, input: Record<string, unknown>) => {
    if (!scriptId) return null;
    const payload: ExecutionPresetUpsertRequest = { name, input };
    const created = await createPreset(scriptId, payload);
    setPresets((prev) => sortPresets([created, ...prev]));
    return created;
  }, [scriptId]);

  const updatePresetInput = useCallback(async (presetId: string, input: Record<string, unknown>) => {
    if (!scriptId) return null;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return null;
    const payload: ExecutionPresetUpsertRequest = { name: preset.name, input };
    const updated = await updatePreset(scriptId, presetId, payload);
    setPresets((prev) => sortPresets(prev.map((p) => p.id === presetId ? updated : p)));
    return updated;
  }, [scriptId, presets]);

  const renamePreset = useCallback(async (presetId: string, newName: string) => {
    if (!scriptId) return null;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return null;
    const payload: ExecutionPresetUpsertRequest = { name: newName, input: preset.input };
    const updated = await updatePreset(scriptId, presetId, payload);
    setPresets((prev) => sortPresets(prev.map((p) => p.id === presetId ? updated : p)));
    return updated;
  }, [scriptId, presets]);

  const handleDelete = useCallback(async (presetId: string) => {
    if (!scriptId) return;
    await deletePreset(scriptId, presetId);
    setPresets((prev) => prev.filter((p) => p.id !== presetId));
  }, [scriptId]);

  return {
    presets,
    loading,
    savePreset,
    updatePresetInput,
    renamePreset,
    deletePreset: handleDelete,
    refresh: load
  };
}
