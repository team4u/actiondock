package org.team4u.scriptflow.domain.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class PageDefinition {
    private String id;
    private String name;
    private String renderer = "amis";
    private PageLayout layout = new PageLayout();
    private List<PageComponent> components = new ArrayList<>();
    private List<PageActionDefinition> actions = new ArrayList<>();
    private PageBinding binding = new PageBinding();
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public String getId() {
        return id;
    }

    public PageDefinition setId(String id) {
        this.id = id;
        return this;
    }

    public String getName() {
        return name;
    }

    public PageDefinition setName(String name) {
        this.name = name;
        return this;
    }

    public String getRenderer() {
        return renderer;
    }

    public PageDefinition setRenderer(String renderer) {
        this.renderer = renderer;
        return this;
    }

    public PageLayout getLayout() {
        return layout;
    }

    public PageDefinition setLayout(PageLayout layout) {
        this.layout = layout == null ? new PageLayout() : layout;
        return this;
    }

    public List<PageComponent> getComponents() {
        return components;
    }

    public PageDefinition setComponents(List<PageComponent> components) {
        this.components = components == null ? new ArrayList<>() : components;
        return this;
    }

    public List<PageActionDefinition> getActions() {
        return actions;
    }

    public PageDefinition setActions(List<PageActionDefinition> actions) {
        this.actions = actions == null ? new ArrayList<>() : actions;
        return this;
    }

    public PageBinding getBinding() {
        return binding;
    }

    public PageDefinition setBinding(PageBinding binding) {
        this.binding = binding == null ? new PageBinding() : binding;
        return this;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public PageDefinition setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public PageDefinition setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }
}
