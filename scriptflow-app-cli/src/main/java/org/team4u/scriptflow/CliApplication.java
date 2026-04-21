package org.team4u.scriptflow;

import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.scriptflow.cli.CliRootCommand;
import org.team4u.scriptflow.cli.SpringFactory;
import org.team4u.scriptflow.config.RuntimeConfiguration;
import org.team4u.scriptflow.storage.jpa.StorageConfiguration;
import org.team4u.scriptflow.storage.jpa.entity.ExecutionEntity;
import org.team4u.scriptflow.storage.jpa.entity.ScriptEntity;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.scriptflow.storage.jpa.repo.SpringDataScriptEntityRepository;
import picocli.CommandLine;

@SpringBootApplication(scanBasePackageClasses = CliRootCommand.class)
@EntityScan(basePackageClasses = {ScriptEntity.class, ExecutionEntity.class})
@EnableJpaRepositories(basePackageClasses = {
        SpringDataScriptEntityRepository.class,
        SpringDataExecutionEntityRepository.class
})
@Import({RuntimeConfiguration.class, StorageConfiguration.class})
public class CliApplication {
    public static void main(String[] args) {
        ConfigurableApplicationContext context = new SpringApplicationBuilder(CliApplication.class)
                .web(WebApplicationType.NONE)
                .run(args);
        int exitCode = new CommandLine(context.getBean(CliRootCommand.class), new SpringFactory(context))
                .execute(args);
        context.close();
        System.exit(exitCode);
    }
}
