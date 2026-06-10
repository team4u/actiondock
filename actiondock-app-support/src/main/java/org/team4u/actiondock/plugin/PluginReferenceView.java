package org.team4u.actiondock.plugin;

import java.util.ArrayList;
import java.util.List;

/**
 * 脚本编辑器中的插件参考视图。
 * <p>
 * 聚合已启动的标准插件与可直接调用的系统插件，供脚本示例展示与复制使用。
 */
public class PluginReferenceView {
    private String pluginId;
    private String name;
    private String description;
    private String version;
    private PluginReferenceSourceType sourceType = PluginReferenceSourceType.INSTALLED;
    private boolean started;
    private List<PluginActionView> actions = new ArrayList<>();

    public String getPluginId() {
        return pluginId;
    }

    public PluginReferenceView setPluginId(String pluginId) {
        this.pluginId = pluginId;
        return this;
    }

    public String getName() {
        return name;
    }

    public PluginReferenceView setName(String name) {
        this.name = name;
        return this;
    }

    public String getDescription() {
        return description;
    }

    public PluginReferenceView setDescription(String description) {
        this.description = description;
        return this;
    }

    public String getVersion() {
        return version;
    }

    public PluginReferenceView setVersion(String version) {
        this.version = version;
        return this;
    }

    public PluginReferenceSourceType getSourceType() {
        return sourceType;
    }

    public PluginReferenceView setSourceType(PluginReferenceSourceType sourceType) {
        this.sourceType = sourceType == null ? PluginReferenceSourceType.INSTALLED : sourceType;
        return this;
    }

    public boolean isStarted() {
        return started;
    }

    public PluginReferenceView setStarted(boolean started) {
        this.started = started;
        return this;
    }

    public List<PluginActionView> getActions() {
        return actions;
    }

    public PluginReferenceView setActions(List<PluginActionView> actions) {
        this.actions = actions == null ? new ArrayList<>() : new ArrayList<>(actions);
        return this;
    }
}
