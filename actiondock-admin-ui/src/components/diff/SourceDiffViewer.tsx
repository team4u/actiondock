import { DiffEditor } from "@monaco-editor/react";
import type { ScriptType } from "../../shared/types";

interface SourceDiffViewerProps {
  type?: ScriptType;
  original: string;
  modified: string;
  theme: "vs-light" | "vs-dark";
}

function resolveLanguage(type?: ScriptType): string {
  return type === "PYTHON" ? "python" : "groovy";
}

export function SourceDiffViewer({ type, original, modified, theme }: SourceDiffViewerProps) {
  return (
    <div className="script-diff-source-viewer">
      <DiffEditor
        height="clamp(360px, 62vh, 720px)"
        language={resolveLanguage(type)}
        original={original}
        modified={modified}
        theme={theme}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          lineNumbersMinChars: 3,
          renderSideBySide: true
        }}
      />
    </div>
  );
}
