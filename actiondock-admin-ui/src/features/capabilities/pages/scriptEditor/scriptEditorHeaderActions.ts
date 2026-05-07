export type ScriptEditorMode = "create" | "edit";

export type ScriptEditorHeaderMoreActionKey =
  | "validate"
  | "copy"
  | "import-generated"
  | "discard-draft"
  | "delete";

export interface ScriptEditorHeaderActionState {
  mode: ScriptEditorMode;
  canImportGeneratedScript: boolean;
  isReadOnlyScript: boolean;
  hasUnpublishedChanges: boolean;
  canPublishToRepository: boolean;
  hasCurrentScript: boolean;
}

export interface ScriptEditorHeaderActionModel {
  showSave: boolean;
  showPublish: boolean;
  showMore: boolean;
  showForkOnly: boolean;
  publishMenuKeys: string[];
  moreActionKeys: ScriptEditorHeaderMoreActionKey[];
}

export function buildScriptEditorHeaderActionModel(
  state: ScriptEditorHeaderActionState
): ScriptEditorHeaderActionModel {
  if (state.isReadOnlyScript) {
    return {
      showSave: false,
      showPublish: false,
      showMore: false,
      showForkOnly: true,
      publishMenuKeys: [],
      moreActionKeys: []
    };
  }

  const moreActionKeys: ScriptEditorHeaderMoreActionKey[] = ["validate"];

  if (state.mode === "edit" && state.hasCurrentScript) {
    moreActionKeys.push("copy");
  }

  if (state.mode === "create" && state.canImportGeneratedScript) {
    moreActionKeys.push("import-generated");
  }

  if (state.hasUnpublishedChanges) {
    moreActionKeys.push("discard-draft");
  }

  if (state.mode === "edit" && state.hasCurrentScript) {
    moreActionKeys.push("delete");
  }

  return {
    showSave: true,
    showPublish: true,
    showMore: moreActionKeys.length > 0,
    showForkOnly: false,
    publishMenuKeys: state.canPublishToRepository ? ["publish-to-repository"] : [],
    moreActionKeys
  };
}
