import { useCallback, useEffect, useState } from "react";
import { createPreset, deletePreset, listPresets, updatePreset } from "../api";
import type { ExecutionPreset, ExecutionPresetUpsertRequest } from "../types";

export interface UseExecutionPresetsOptions {
  scriptId: string | undefined | null;
}

export interface UseExecutionPresetsReturn {
  presets: ExecutionPreset[];
  loading: boolean;
  savePreset: (name: string, input: Record<string, unknown>) => Promise<void>;
  renamePreset: (presetId: string, newName: string) => Promise<void>;
  deletePreset: (presetId: string) => Promise<void>;
  refresh: () => void;
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
      setPresets(data);
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
    if (!scriptId) return;
    const payload: ExecutionPresetUpsertRequest = { name, input };
    const created = await createPreset(scriptId, payload);
    setPresets((prev) => [created, ...prev]);
  }, [scriptId]);

  const renamePreset = useCallback(async (presetId: string, newName: string) => {
    if (!scriptId) return;
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    const payload: ExecutionPresetUpsertRequest = { name: newName, input: preset.input };
    const updated = await updatePreset(scriptId, presetId, payload);
    setPresets((prev) => prev.map((p) => p.id === presetId ? updated : p));
  }, [scriptId, presets]);

  const handleDelete = useCallback(async (presetId: string) => {
    if (!scriptId) return;
    await deletePreset(scriptId, presetId);
    setPresets((prev) => prev.filter((p) => p.id !== presetId));
  }, [scriptId]);

  return { presets, loading, savePreset, renamePreset, deletePreset: handleDelete, refresh: load };
}
