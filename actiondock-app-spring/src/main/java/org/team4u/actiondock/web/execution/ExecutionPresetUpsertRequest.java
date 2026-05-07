package org.team4u.actiondock.web.execution;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 执行参数预设创建/更新请求。
 *
 * @author jay.wu
 */
public class ExecutionPresetUpsertRequest {

    private String name;
    private Map<String, Object> input = new LinkedHashMap<>();

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Map<String, Object> getInput() {
        return input;
    }

    public void setInput(Map<String, Object> input) {
        this.input = input == null ? new LinkedHashMap<>() : new LinkedHashMap<>(input);
    }
}
