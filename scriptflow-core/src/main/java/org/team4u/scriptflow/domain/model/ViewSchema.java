package org.team4u.scriptflow.domain.model;

import java.util.ArrayList;
import java.util.List;

public class ViewSchema {
    private String pageId;
    private String title;
    private String renderer;
    private PageLayout layout = new PageLayout();
    private List<ViewField> inputFields = new ArrayList<>();
    private List<ViewField> outputFields = new ArrayList<>();
    private List<ViewAction> actions = new ArrayList<>();

    public String getPageId() {
        return pageId;
    }

    public ViewSchema setPageId(String pageId) {
        this.pageId = pageId;
        return this;
    }

    public String getTitle() {
        return title;
    }

    public ViewSchema setTitle(String title) {
        this.title = title;
        return this;
    }

    public String getRenderer() {
        return renderer;
    }

    public ViewSchema setRenderer(String renderer) {
        this.renderer = renderer;
        return this;
    }

    public PageLayout getLayout() {
        return layout;
    }

    public ViewSchema setLayout(PageLayout layout) {
        this.layout = layout == null ? new PageLayout() : layout;
        return this;
    }

    public List<ViewField> getInputFields() {
        return inputFields;
    }

    public ViewSchema setInputFields(List<ViewField> inputFields) {
        this.inputFields = inputFields == null ? new ArrayList<>() : inputFields;
        return this;
    }

    public List<ViewField> getOutputFields() {
        return outputFields;
    }

    public ViewSchema setOutputFields(List<ViewField> outputFields) {
        this.outputFields = outputFields == null ? new ArrayList<>() : outputFields;
        return this;
    }

    public List<ViewAction> getActions() {
        return actions;
    }

    public ViewSchema setActions(List<ViewAction> actions) {
        this.actions = actions == null ? new ArrayList<>() : actions;
        return this;
    }
}
