import Editor from "@monaco-editor/react";
import { registerGroovyLanguage } from "./monacoGroovy";

registerGroovyLanguage();

interface CodeEditorProps {
  value?: string;
  onChange: (nextValue: string) => void;
  theme: "vs-light" | "vs-dark";
  language?: string;
  defaultLanguage?: string;
  height?: string;
  placeholder?: string;
  readOnly?: boolean;
}

export function CodeEditor({
  value,
  onChange,
  theme,
  language = "json",
  defaultLanguage,
  height = "260px",
  placeholder,
  readOnly = false
}: CodeEditorProps) {
  const safeValue = value ?? "";

  return (
    <div className="app-code-editor">
      <Editor
        height={height}
        defaultLanguage={defaultLanguage ?? language}
        language={language}
        value={safeValue}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        theme={theme}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          tabSize: 2,
          lineNumbersMinChars: 3,
          padding: { top: 12, bottom: 12 },
          readOnly
        }}
      />
      {placeholder && !safeValue.trim() ? (
        <div className="app-code-editor__placeholder">{placeholder}</div>
      ) : null}
    </div>
  );
}
