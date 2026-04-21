package org.team4u.scriptflow;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.ExecutionStatus;
import org.team4u.scriptflow.domain.model.ScriptDefinition;
import org.team4u.scriptflow.domain.model.ScriptType;
import org.team4u.scriptflow.domain.model.SubmitMode;

import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SharedStorageIntegrationTest {
    @TempDir
    Path tempDir;

    @Test
    void webAndCliContextsShareTheSameConfiguredStorage() {
        String dbUrl = "jdbc:h2:file:" + tempDir.resolve("shared-runtime").toAbsolutePath().toString().replace("\\", "/") + ";AUTO_SERVER=TRUE";

        try (ConfigurableApplicationContext webContext = new SpringApplicationBuilder(RuntimeApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties(runtimeProperties(dbUrl, "servlet"))
                .run()) {
            ScriptApplicationService scriptApplicationService = webContext.getBean(ScriptApplicationService.class);
            scriptApplicationService.save(new ScriptDefinition()
                    .setId("integration-script")
                    .setName("Integration Script")
                    .setType(ScriptType.GROOVY)
                    .setSource("return [message: 'Hello, ' + input.name]")
                    .setInputSchema(Map.of("type", "object"))
                    .setOutputSchema(Map.of("type", "object")));
            scriptApplicationService.publish("integration-script");
        }

        try (ConfigurableApplicationContext cliContext = new SpringApplicationBuilder(CliApplication.class)
                .web(WebApplicationType.NONE)
                .properties(runtimeProperties(dbUrl, "none"))
                .run()) {
            ExecutionApplicationService executionApplicationService = cliContext.getBean(ExecutionApplicationService.class);
            ExecutionRecord record = executionApplicationService.execute(
                    "integration-script",
                    Map.of("name", "Alice"),
                    SubmitMode.SYNC
            );

            assertThat(record.getStatus()).isEqualTo(ExecutionStatus.SUCCESS);
            assertThat(record.getOutput()).containsEntry("message", "Hello, Alice");
        }
    }

    private static String[] runtimeProperties(String dbUrl, String webApplicationType) {
        return new String[] {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.main.web-application-type=" + webApplicationType,
                "spring.datasource.url=" + dbUrl,
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=update",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        };
    }
}
