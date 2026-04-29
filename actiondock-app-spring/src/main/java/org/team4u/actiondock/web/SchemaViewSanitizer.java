package org.team4u.actiondock.web;

import org.team4u.actiondock.domain.model.ScriptDefinition;

/**
 * 模式视图清洗器，委托给领域对象的 UI 字段移除逻辑。
 *
 * @author jay.wu
 */
final class SchemaViewSanitizer {
    private SchemaViewSanitizer() {
    }

    /**
     * 清洗脚本定义中的 UI 扩展字段。
     *
     * @param definition 原始脚本定义
     * @return 清洗后的脚本定义
     */
    static ScriptDefinition sanitize(ScriptDefinition definition) {
        return definition.withoutUiSchema();
    }
}
