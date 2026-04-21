package org.team4u.scriptflow.domain.port;

import org.team4u.scriptflow.domain.model.ViewSchema;

import java.util.Map;

public interface PageSchemaRenderer {
    Map<String, Object> render(ViewSchema schema);
}
