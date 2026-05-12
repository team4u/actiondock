import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { PluginReferenceView, ScriptDefinition } from "../../../../shared/types";
import { getPublishedScriptContent } from "../../../../services/scriptPublication";

export interface UseScriptReferencesParams {
  currentScript: ScriptDefinition | null;
  availableScripts: ScriptDefinition[];
  availablePlugins: PluginReferenceView[];
}

export interface ScriptReferencesContext {
  referencePluginId: string | null;
  setReferencePluginId: (id: string | null) => void;
  pluginReferenceQuery: string;
  setPluginReferenceQuery: (query: string) => void;
  pluginReferencePage: number;
  setPluginReferencePage: (page: number) => void;
  pluginReferencePageSize: number;
  setPluginReferencePageSize: (size: number) => void;
  referenceScriptId: string | null;
  setReferenceScriptId: (id: string | null) => void;
  scriptReferenceQuery: string;
  setScriptReferenceQuery: (query: string) => void;
  scriptReferencePage: number;
  setScriptReferencePage: (page: number) => void;
  scriptReferencePageSize: number;
  setScriptReferencePageSize: (size: number) => void;
  pluginReferences: PluginReferenceView[];
  scriptReferences: ScriptDefinition[];
  filteredPluginReferences: PluginReferenceView[];
  filteredScriptReferences: ScriptDefinition[];
  referencePlugin: PluginReferenceView | null;
  referenceScript: ScriptDefinition | null;
}

export function useScriptReferences({
  currentScript,
  availableScripts,
  availablePlugins
}: UseScriptReferencesParams): ScriptReferencesContext {
  const [referencePluginId, setReferencePluginId] = useState<string | null>(null);
  const [pluginReferenceQuery, setPluginReferenceQuery] = useState("");
  const [pluginReferencePage, setPluginReferencePage] = useState(1);
  const [pluginReferencePageSize, setPluginReferencePageSize] = useState(10);
  const [referenceScriptId, setReferenceScriptId] = useState<string | null>(null);
  const [scriptReferenceQuery, setScriptReferenceQuery] = useState("");
  const [scriptReferencePage, setScriptReferencePage] = useState(1);
  const [scriptReferencePageSize, setScriptReferencePageSize] = useState(10);

  const deferredPluginReferenceQuery = useDeferredValue(pluginReferenceQuery);
  const deferredScriptReferenceQuery = useDeferredValue(scriptReferenceQuery);

  const pluginReferences = useMemo(
    () => availablePlugins,
    [availablePlugins]
  );
  const scriptReferences = useMemo(
    () => availableScripts.filter(
      (script) => Boolean(getPublishedScriptContent(script)) && script.id !== currentScript?.id
    ),
    [availableScripts, currentScript?.id]
  );

  const filteredPluginReferences = useMemo(() => {
    const normalizedQuery = deferredPluginReferenceQuery.trim().toLowerCase();
    if (!normalizedQuery) return pluginReferences;
    return pluginReferences.filter((plugin) => {
      const haystack = `${plugin.name || ""} ${plugin.pluginId}`.toLowerCase();
      return normalizedQuery.split(/\s+/).every((keyword) => haystack.includes(keyword));
    });
  }, [deferredPluginReferenceQuery, pluginReferences]);

  const filteredScriptReferences = useMemo(() => {
    const normalizedQuery = deferredScriptReferenceQuery.trim().toLowerCase();
    if (!normalizedQuery) return scriptReferences;
    return scriptReferences.filter((script) => {
      const published = getPublishedScriptContent(script);
      const haystack = `${script.name || ""} ${script.id} ${published?.name || ""}`.toLowerCase();
      return normalizedQuery.split(/\s+/).every((keyword) => haystack.includes(keyword));
    });
  }, [deferredScriptReferenceQuery, scriptReferences]);

  const referencePlugin = useMemo(
    () => pluginReferences.find((plugin) => plugin.pluginId === referencePluginId) ?? null,
    [pluginReferences, referencePluginId]
  );
  const referenceScript = useMemo(
    () => scriptReferences.find((script) => script.id === referenceScriptId) ?? null,
    [scriptReferences, referenceScriptId]
  );

  useEffect(() => {
    if (referencePluginId && !pluginReferences.some((plugin) => plugin.pluginId === referencePluginId)) {
      setReferencePluginId(null);
    }
  }, [pluginReferences, referencePluginId]);

  useEffect(() => {
    if (referenceScriptId && !scriptReferences.some((script) => script.id === referenceScriptId)) {
      setReferenceScriptId(null);
    }
  }, [referenceScriptId, scriptReferences]);

  useEffect(() => {
    setPluginReferencePage(1);
  }, [deferredPluginReferenceQuery]);

  useEffect(() => {
    setScriptReferencePage(1);
  }, [deferredScriptReferenceQuery]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredPluginReferences.length / pluginReferencePageSize));
    if (pluginReferencePage > maxPage) {
      setPluginReferencePage(maxPage);
    }
  }, [filteredPluginReferences.length, pluginReferencePage, pluginReferencePageSize]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredScriptReferences.length / scriptReferencePageSize));
    if (scriptReferencePage > maxPage) {
      setScriptReferencePage(maxPage);
    }
  }, [filteredScriptReferences.length, scriptReferencePage, scriptReferencePageSize]);

  return {
    referencePluginId,
    setReferencePluginId,
    pluginReferenceQuery,
    setPluginReferenceQuery,
    pluginReferencePage,
    setPluginReferencePage,
    pluginReferencePageSize,
    setPluginReferencePageSize,
    referenceScriptId,
    setReferenceScriptId,
    scriptReferenceQuery,
    setScriptReferenceQuery,
    scriptReferencePage,
    setScriptReferencePage,
    scriptReferencePageSize,
    setScriptReferencePageSize,
    pluginReferences,
    scriptReferences,
    filteredPluginReferences,
    filteredScriptReferences,
    referencePlugin,
    referenceScript
  };
}
