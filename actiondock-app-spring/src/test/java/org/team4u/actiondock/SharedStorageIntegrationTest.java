package org.team4u.actiondock;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.application.ExecutionApplicationService;
import org.team4u.actiondock.application.ExecutionPresetApplicationService;
import org.team4u.actiondock.application.ScriptApplicationService;
import org.team4u.actiondock.domain.model.ExecutionRecord;
import org.team4u.actiondock.domain.model.ExecutionPreset;
import org.team4u.actiondock.domain.model.RepositoryLocalAsset;
import org.team4u.actiondock.domain.model.RepositoryLocalAssetMode;
import org.team4u.actiondock.domain.model.ExecutionStatus;
import org.team4u.actiondock.domain.model.ScriptDefinition;
import org.team4u.actiondock.domain.model.ScriptSchedule;
import org.team4u.actiondock.domain.model.ScriptType;
import org.team4u.actiondock.domain.model.SubmitMode;
import org.team4u.actiondock.domain.model.UpstreamAssetType;
import org.team4u.actiondock.config.RuntimeConfiguration;
import org.team4u.actiondock.domain.port.RepositoryLocalAssetRepository;
import org.team4u.actiondock.domain.port.ScriptScheduleRepository;
import org.team4u.actiondock.storage.jpa.StorageConfiguration;
import org.team4u.actiondock.storage.jpa.entity.ExecutionEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
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

        try (ConfigurableApplicationContext cliContext = new SpringApplicationBuilder(CliLikeTestApplication.class)
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

    @Test
    void startupAutomaticallyUpdatesLegacyScriptTableAndDefaultsPackaging() throws SQLException {
        String dbUrl = "jdbc:h2:file:" + tempDir.resolve("legacy-runtime").toAbsolutePath().toString().replace("\\", "/") + ";AUTO_SERVER=TRUE";
        createLegacyScriptSchemaWithoutPackaging(dbUrl);

        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(RuntimeApplication.class)
                .web(WebApplicationType.NONE)
                .properties(runtimeProperties(dbUrl, "none"))
                .run()) {
            ScriptApplicationService scriptApplicationService = context.getBean(ScriptApplicationService.class);
            ScriptDefinition draft = scriptApplicationService.get("legacy-script");
            ScriptDefinition published = scriptApplicationService.getPublished("legacy-script");

            assertThat(draft.getPackaging().name()).isEqualTo("TOOL");
            assertThat(published.getPackaging().name()).isEqualTo("TOOL");
            assertThat(published.getPublishedRevision()).isNotNull();
            assertThat(published.getPublishedRevision().getPackaging().name()).isEqualTo("TOOL");
        }
    }

    @Test
    void deletePublishedScriptRemovesRelatedRowsWithinSpringManagedTransaction() throws SQLException {
        String dbUrl = "jdbc:h2:file:" + tempDir.resolve("delete-script-runtime").toAbsolutePath().toString().replace("\\", "/") + ";AUTO_SERVER=TRUE";

        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(RuntimeApplication.class)
                .web(WebApplicationType.NONE)
                .properties(runtimeProperties(dbUrl, "none"))
                .run()) {
            ScriptApplicationService scriptApplicationService = context.getBean(ScriptApplicationService.class);
            ScriptScheduleRepository scriptScheduleRepository = context.getBean(ScriptScheduleRepository.class);
            RepositoryLocalAssetRepository repositoryLocalAssetRepository = context.getBean(RepositoryLocalAssetRepository.class);

            scriptApplicationService.save(new ScriptDefinition()
                    .setId("delete-script")
                    .setName("Delete Script")
                    .setType(ScriptType.GROOVY)
                    .setSource("return [message: 'delete']")
                    .setInputSchema(Map.of("type", "object"))
                    .setOutputSchema(Map.of("type", "object")));
            scriptApplicationService.publish("delete-script");

            scriptScheduleRepository.save(new ScriptSchedule()
                    .setId("schedule-1")
                    .setScriptId("delete-script")
                    .setName("Delete Schedule")
                    .setCronExpression("0 0 2 * * *")
                    .setInput(Map.of("mode", "nightly")));
            repositoryLocalAssetRepository.save(new RepositoryLocalAsset()
                    .setId("asset-1")
                    .setAssetType(UpstreamAssetType.SCRIPT)
                    .setLocalAssetId("delete-script")
                    .setRepositoryId("repo-1")
                    .setUpstreamAssetId("tool-1")
                    .setMode(RepositoryLocalAssetMode.TRACKED));

            scriptApplicationService.delete("delete-script");
        }

        assertThat(countRows(dbUrl, "script_definition", "id = 'delete-script'")).isZero();
        assertThat(countRows(dbUrl, "published_script_revision", "script_id = 'delete-script'")).isZero();
        assertThat(countRows(dbUrl, "script_schedule", "script_id = 'delete-script'")).isZero();
        assertThat(countRows(dbUrl, "repository_local_asset", "local_asset_id = 'delete-script'")).isZero();
    }

    @Test
    void startupMigratesLegacyExecutionPresetTableAndBackfillsBooleanFlags() throws SQLException {
        String dbUrl = "jdbc:h2:file:" + tempDir.resolve("legacy-preset-runtime").toAbsolutePath().toString().replace("\\", "/") + ";AUTO_SERVER=TRUE";
        createLegacyExecutionPresetSchemaWithoutManagedAndEditable(dbUrl);

        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(CliLikeTestApplication.class)
                .web(WebApplicationType.NONE)
                .properties(runtimeProperties(dbUrl, "none"))
                .run()) {
            ExecutionPresetApplicationService executionPresetApplicationService = context.getBean(ExecutionPresetApplicationService.class);
            List<ExecutionPreset> presets = executionPresetApplicationService.list("legacy-script");

            assertThat(presets).singleElement().satisfies(preset -> {
                assertThat(preset.isEditable()).isTrue();
                assertThat(preset.isManaged()).isFalse();
            });
            assertThat(readAppliedVersions(dbUrl)).contains("0", "1", "2");
            assertThat(columnExists(dbUrl, "EXECUTION_PRESET", "EDITABLE")).isTrue();
            assertThat(columnExists(dbUrl, "EXECUTION_PRESET", "MANAGED")).isTrue();
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
                "spring.jpa.hibernate.ddl-auto=validate",
                "spring.flyway.enabled=true",
                "spring.flyway.locations=classpath:db/migration",
                "spring.flyway.baseline-on-migrate=true",
                "spring.flyway.baseline-version=0",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        };
    }

    private static void createLegacyScriptSchemaWithoutPackaging(String dbUrl) throws SQLException {
        try (var connection = DriverManager.getConnection(dbUrl, "sa", "");
             var statement = connection.createStatement()) {
            statement.execute("""
                    create table script_definition (
                        id varchar(255) primary key,
                        name varchar(255) not null,
                        type varchar(255) not null,
                        packaging varchar(255),
                        source clob not null,
                        input_schema_json clob,
                        output_schema_json clob,
                        published_name varchar(255),
                        published_type varchar(255),
                        published_packaging varchar(255),
                        published_source clob,
                        published_python_requirements clob,
                        published_owner varchar(255),
                        published_description clob,
                        published_tags_json clob,
                        published_plugin_dependencies_json clob,
                        published_input_schema_json clob,
                        published_output_schema_json clob,
                        published_script_dependencies_json clob,
                        published_ai_dependencies_json clob,
                        status varchar(255),
                        version_value integer,
                        scope varchar(255),
                        repository_id varchar(255),
                        repository_tool_id varchar(255),
                        repository_version varchar(255),
                        source_path varchar(255),
                        source_commit varchar(255),
                        source_digest varchar(255),
                        source_synced_at timestamp,
                        dirty boolean,
                        editable boolean,
                        owner varchar(255),
                        description clob,
                        tags_json clob,
                        script_dependencies_json clob,
                        plugin_dependencies_json clob,
                        ai_dependencies_json clob,
                        created_at timestamp,
                        updated_at timestamp
                    )
                    """);
            statement.execute("""
                    insert into script_definition (
                        id, name, type, source,
                        published_name, published_type, published_source,
                        status, version_value, scope, dirty, editable,
                        tags_json, plugin_dependencies_json, ai_dependencies_json
                    ) values (
                        'legacy-script', 'Legacy Script', 'GROOVY', 'return [message: "draft"]',
                        'Legacy Script', 'GROOVY', 'return [message: "published"]',
                        'PUBLISHED', 1, 'PERSONAL', false, true,
                        '[]', '[]', '[]'
                    )
                    """);
        }
    }

    private static void createLegacyExecutionPresetSchemaWithoutManagedAndEditable(String dbUrl) throws SQLException {
        try (var connection = DriverManager.getConnection(dbUrl, "sa", "");
             var statement = connection.createStatement()) {
            statement.execute("""
                    create table execution_preset (
                        id varchar(255) primary key,
                        script_id varchar(255) not null,
                        name varchar(255) not null,
                        input_json clob,
                        created_at timestamp,
                        updated_at timestamp
                    )
                    """);
            statement.execute("""
                    insert into execution_preset (
                        id, script_id, name, input_json, created_at, updated_at
                    ) values (
                        'preset-1', 'legacy-script', 'Legacy preset', '{}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
                    )
                    """);
        }
    }

    private static List<String> readAppliedVersions(String dbUrl) throws SQLException {
        List<String> versions = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(dbUrl, "sa", "");
             var statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(
                     "select \"version\" from \"flyway_schema_history\" order by \"installed_rank\"")) {
            while (resultSet.next()) {
                versions.add(resultSet.getString(1));
            }
        }
        return versions;
    }

    private static boolean columnExists(String dbUrl, String tableName, String columnName) throws SQLException {
        try (Connection connection = DriverManager.getConnection(dbUrl, "sa", "");
             ResultSet columns = connection.getMetaData().getColumns(null, "PUBLIC", tableName, columnName)) {
            return columns.next();
        }
    }

    private static int countRows(String dbUrl, String tableName, String whereClause) throws SQLException {
        try (Connection connection = DriverManager.getConnection(dbUrl, "sa", "");
             var statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(
                     "select count(*) from " + tableName + " where " + whereClause)) {
            resultSet.next();
            return resultSet.getInt(1);
        }
    }

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan(basePackageClasses = {ScriptEntity.class, ExecutionEntity.class})
    @EnableJpaRepositories(basePackageClasses = {
            SpringDataScriptEntityRepository.class,
            SpringDataExecutionEntityRepository.class
    })
    @Import({RuntimeConfiguration.class, StorageConfiguration.class})
    static class CliLikeTestApplication {
    }
}
