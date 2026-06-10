import { describe, expect, it } from "vitest";
import { buildScriptEditorHeaderActionModel } from "./scriptEditorHeaderActions";

describe("buildScriptEditorHeaderActionModel", () => {
  it("shows only save, publish and more for create mode", () => {
    const model = buildScriptEditorHeaderActionModel({
      mode: "create",
      canImportGeneratedScript: true,
      isReadOnlyScript: false,
      hasUnpublishedChanges: false,
      canPublishToRepository: false,
      hasCurrentScript: false
    });

    expect(model.showSave).toBe(true);
    expect(model.showPublish).toBe(true);
    expect(model.showMore).toBe(true);
    expect(model.showForkOnly).toBe(false);
    expect(model.publishMenuKeys).toEqual([]);
    expect(model.moreActionKeys).toEqual(["validate", "import-generated"]);
  });

  it("shows publish menu and edit actions for editable saved scripts", () => {
    const model = buildScriptEditorHeaderActionModel({
      mode: "edit",
      canImportGeneratedScript: false,
      isReadOnlyScript: false,
      hasUnpublishedChanges: false,
      canPublishToRepository: true,
      hasCurrentScript: true
    });

    expect(model.publishMenuKeys).toEqual(["publish-to-repository"]);
    expect(model.moreActionKeys).toEqual(["validate", "copy", "delete"]);
  });

  it("adds discard draft only when unpublished changes exist", () => {
    const model = buildScriptEditorHeaderActionModel({
      mode: "edit",
      canImportGeneratedScript: false,
      isReadOnlyScript: false,
      hasUnpublishedChanges: true,
      canPublishToRepository: true,
      hasCurrentScript: true
    });

    expect(model.moreActionKeys).toEqual(["validate", "copy", "discard-draft", "delete"]);
  });

  it("keeps create mode compact when generated import is unavailable", () => {
    const model = buildScriptEditorHeaderActionModel({
      mode: "create",
      canImportGeneratedScript: false,
      isReadOnlyScript: false,
      hasUnpublishedChanges: false,
      canPublishToRepository: false,
      hasCurrentScript: false
    });

    expect(model.moreActionKeys).toEqual(["validate"]);
    expect(model.showMore).toBe(true);
  });

  it("collapses read-only repository tools to fork-only mode", () => {
    const model = buildScriptEditorHeaderActionModel({
      mode: "edit",
      canImportGeneratedScript: false,
      isReadOnlyScript: true,
      hasUnpublishedChanges: false,
      canPublishToRepository: false,
      hasCurrentScript: true
    });

    expect(model).toEqual({
      showSave: false,
      showPublish: false,
      showMore: false,
      showForkOnly: true,
      publishMenuKeys: [],
      moreActionKeys: []
    });
  });
});
