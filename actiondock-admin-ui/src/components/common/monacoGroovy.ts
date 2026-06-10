import { loader } from "@monaco-editor/react";
import type { languages } from "monaco-editor";

type StandaloneThemeData = Parameters<typeof import("monaco-editor").editor.defineTheme>[1];

let registered = false;

export function registerGroovyLanguage() {
  if (typeof window === "undefined") {
    return;
  }
  if (registered) return;
  registered = true;

  loader.init().then((monaco) => {
    if (monaco.languages.getLanguages().some((l) => l.id === "groovy")) return;

    monaco.languages.register({ id: "groovy", extensions: [".groovy"] });
    monaco.languages.setMonarchTokensProvider("groovy", groovyTokens);
    monaco.languages.setLanguageConfiguration("groovy", groovyConfig);
    monaco.editor.defineTheme("groovy-dark", groovyDarkTheme);
    monaco.editor.defineTheme("groovy-light", groovyLightTheme);
  });
}

const groovyConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'", notIn: ["string", "comment"] },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "/*", close: " */", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "'", close: "'" },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /^\s*\/\/\s*#?region\b/,
      end: /^\s*\/\/\s*#?endregion\b/,
    },
  },
};

const groovyTokens: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".groovy",

  keywords: [
    "abstract", "as", "assert", "break", "case", "catch", "class", "const",
    "continue", "def", "default", "do", "else", "enum", "extends", "final",
    "finally", "for", "goto", "if", "implements", "import", "in", "instanceof",
    "interface", "native", "new", "package", "private", "protected", "public",
    "return", "static", "strictfp", "super", "switch", "synchronized", "this",
    "throw", "throws", "transient", "try", "void", "volatile", "while",
    "true", "false", "null", "trait",
  ],

  operators: [
    "=", ">", "<", "!", "~", "?:", "==", "<=", ">=", "!=", "&&", "||", "++",
    "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", ">>>", "+=",
    "-=", "*=", "/=", "&=", "|=", "^=", "%=", "<<=", ">>=", ">>>=", "->", ":",
    "?", "?.", "*.", ".@", ".&", "===", "!==", "<=>",
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  digits: /\d+(_+\d+)*/,

  tokenizer: {
    root: [
      [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      { include: "@whitespace" },
      [/[{}()[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      [/@digits((\.@digits)?([eE][\-+]?@digits)?)[fFdD]?/, "number.float"],
      [/@digits[lL]?/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"""/, "string", "@string_triple"],
      [/"/, "string", "@string_double"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/'''/, "string", "@string_triple_single"],
      [/'/, "string", "@string_single"],
      [/\//, "delimiter", "@slash"],
    ],

    slash: [
      [/\/\//, "comment", "@line_comment_groovydoc"],
      [/\//, "comment", "@line_comment"],
      [/\*/, "comment", "@comment"],
      [/[^\/*]/, "operator", "@pop"],
    ],

    line_comment_groovydoc: [
      [/@\w+/, "keyword"],
      [/.*$/, "comment.doc", "@pop"],
    ],

    comment: [
      [/[^\/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[\/*]/, "comment"],
    ],

    line_comment: [
      [/.*$/, "comment", "@pop"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],

    string_double: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],

    string_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, "string", "@pop"],
    ],

    string_triple: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"{3}/, "string", "@pop"],      [/"/, "string"],
    ],

    string_triple_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'''/, "string", "@pop"],
      [/'/, "string"],
    ],
  },
};

const groovyDarkTheme: StandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "569CD6" },
    { token: "string", foreground: "CE9178" },
    { token: "string.escape", foreground: "D7BA7D" },
    { token: "comment", foreground: "6A9955" },
    { token: "comment.doc", foreground: "6A9955" },
    { token: "number", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "operator", foreground: "D4D4D4" },
    { token: "delimiter", foreground: "D4D4D4" },
    { token: "identifier", foreground: "9CDCFE" },
  ],
  colors: {},
};

const groovyLightTheme: StandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "0000FF" },
    { token: "string", foreground: "A31515" },
    { token: "string.escape", foreground: "E50000" },
    { token: "comment", foreground: "008000" },
    { token: "comment.doc", foreground: "008000" },
    { token: "number", foreground: "098658" },
    { token: "number.float", foreground: "098658" },
    { token: "operator", foreground: "000000" },
    { token: "delimiter", foreground: "000000" },
    { token: "identifier", foreground: "001080" },
  ],
  colors: {},
};
