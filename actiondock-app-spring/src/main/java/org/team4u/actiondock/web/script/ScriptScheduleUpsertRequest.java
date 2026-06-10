package org.team4u.actiondock.web.script;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 脚本调度创建/更新请求。
 *
 * @author jay.wu
 */
public class ScriptScheduleUpsertRequest {
    private String scriptId;
    private String name;
    private String cronExpression;
    private Map<String, Object> input = new LinkedHashMap<>();
    private boolean enabled = true;

    public String getScriptId() {
        return scriptId;
    }

    public void setScriptId(String scriptId) {
        this.scriptId = scriptId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCronExpression() {
        return cronExpression;
    }

    public void setCronExpression(String cronExpression) {
        this.cronExpression = cronExpression;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public void setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
}
