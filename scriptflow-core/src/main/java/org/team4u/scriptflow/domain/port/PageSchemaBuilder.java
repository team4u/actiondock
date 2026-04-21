package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.PageDefinition;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ViewSchema;

public interface PageSchemaBuilder {
    ViewSchema build(PageDefinition pageDefinition, ScriptDefinition scriptDefinition);
}
