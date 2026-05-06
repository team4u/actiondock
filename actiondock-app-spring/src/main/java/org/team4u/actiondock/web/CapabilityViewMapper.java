package org.team4u.actiondock.web;

import org.springframework.stereotype.Component;
import org.team4u.actiondock.domain.model.PublishedScriptSnapshot;
import org.team4u.actiondock.domain.model.SchemaValueCopier;
import org.team4u.actiondock.domain.model.ScriptDefinition;

import java.util.List;
import java.util.Map;

/**
 * 将脚本定义映射为统一能力视图。
 */
@Component
public class CapabilityViewMapper {

    public CapabilityView toView(ScriptDefinition source, boolean includeUiSchema) {
        ScriptDefinition sanitized = includeUiSchema ? source : ScriptViewMapper.withoutUiSchema(source);
        return new CapabilityView(
                sanitized.getId(),
                "script",
                sanitized.getName(),
                enumName(sanitized.getType()),
                sanitized.getSource(),
                enumName(sanitized.getStatus()),
                sanitized.getVersion(),
                enumName(sanitized.getScope()),
                sanitized.getDescription(),
                sanitized.getOwner(),
                sanitized.getTags(),
                toDraftBinding(sanitized),
                toPublishedBinding(sanitized, sanitized.getPublishedSnapshot()),
                sanitized.getCreatedAt(),
                sanitized.getUpdatedAt()
        );
    }

    private CapabilityView.CapabilityBindingView toDraftBinding(ScriptDefinition source) {
        return new CapabilityView.CapabilityBindingView(
                source.getVersion() == null ? null : String.valueOf(source.getVersion()),
                source.getSource(),
                enumName(source.getType()),
                copySchema(source.getInputSchema()),
                copySchema(source.getOutputSchema()),
                enumName(source.getPackaging()),
                List.copyOf(source.getScriptDependencies())
        );
    }

    private CapabilityView.CapabilityBindingView toPublishedBinding(ScriptDefinition source, PublishedScriptSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }
        return new CapabilityView.CapabilityBindingView(
                null,
                snapshot.getSource(),
                enumName(snapshot.getType()),
                copySchema(snapshot.getInputSchema()),
                copySchema(snapshot.getOutputSchema()),
                enumName(snapshot.getPackaging()),
                List.copyOf(snapshot.getScriptDependencies())
        );
    }

    private static Map<String, Object> copySchema(Map<String, Object> schema) {
        return SchemaValueCopier.copyMap(schema);
    }

    private static String enumName(Enum<?> value) {
        return value == null ? null : value.name();
    }
}
