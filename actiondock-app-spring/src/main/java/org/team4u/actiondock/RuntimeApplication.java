package org.team4u.actiondock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.team4u.actiondock.auth.AuthConfiguration;
import org.team4u.actiondock.bootstrap.SampleDataInitializer;
import org.team4u.actiondock.config.RuntimeConfiguration;
import org.team4u.actiondock.config.WebCorsConfiguration;
import org.team4u.actiondock.schedule.ScheduleConfiguration;
import org.team4u.actiondock.storage.jpa.StorageConfiguration;
import org.team4u.actiondock.storage.jpa.entity.ExecutionEntity;
import org.team4u.actiondock.storage.jpa.entity.PluginRegistrationEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptScheduleEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPluginRegistrationRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;
import org.team4u.actiondock.web.ScriptController;

@SpringBootApplication(scanBasePackageClasses = {ScriptController.class, SampleDataInitializer.class})
@EntityScan(basePackageClasses = {ScriptEntity.class, ExecutionEntity.class, PluginRegistrationEntity.class, ScriptScheduleEntity.class})
@EnableJpaRepositories(basePackageClasses = {
        SpringDataScriptEntityRepository.class,
        SpringDataExecutionEntityRepository.class,
        SpringDataPluginRegistrationRepository.class,
        SpringDataScriptScheduleEntityRepository.class
})
@Import({RuntimeConfiguration.class, StorageConfiguration.class, AuthConfiguration.class, WebCorsConfiguration.class, ScheduleConfiguration.class})
/**
 * ActionDock 运行时应用入口。
 *
 * @author jay.wu
 */
public class RuntimeApplication {
    public static void main(String[] args) {
        SpringApplication.run(RuntimeApplication.class, args);
    }
}
