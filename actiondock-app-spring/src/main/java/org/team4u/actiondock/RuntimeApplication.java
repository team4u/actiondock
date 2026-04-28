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
import org.team4u.actiondock.storage.jpa.entity.AiAgentProfileEntity;
import org.team4u.actiondock.storage.jpa.entity.AiAgentApprovalEntity;
import org.team4u.actiondock.storage.jpa.entity.AiAgentRunEntity;
import org.team4u.actiondock.storage.jpa.entity.AiAgentStepEntity;
import org.team4u.actiondock.storage.jpa.entity.AiCallLogEntity;
import org.team4u.actiondock.storage.jpa.entity.AiModelProfileEntity;
import org.team4u.actiondock.storage.jpa.entity.AiToolsetEntity;
import org.team4u.actiondock.storage.jpa.entity.ApiAccessTokenEntity;
import org.team4u.actiondock.storage.jpa.entity.PluginRegistrationEntity;
import org.team4u.actiondock.storage.jpa.entity.RepositoryAiPackageInstallationEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.entity.ScriptScheduleEntity;
import org.team4u.actiondock.storage.jpa.entity.ConfigValueEntity;
import org.team4u.actiondock.storage.jpa.entity.SharedStateEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataApiAccessTokenRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentProfileRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentApprovalRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentRunRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiAgentStepRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiCallLogRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiModelProfileRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataAiToolsetRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataConfigValueRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataExecutionEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataPluginRegistrationRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataRepositoryAiPackageInstallationRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptScheduleEntityRepository;
import org.team4u.actiondock.storage.jpa.repo.SpringDataSharedStateRepository;
import org.team4u.actiondock.web.ScriptController;

@SpringBootApplication(scanBasePackageClasses = {ScriptController.class, SampleDataInitializer.class})
@EntityScan(basePackageClasses = {
        ScriptEntity.class,
        ExecutionEntity.class,
        PluginRegistrationEntity.class,
        ScriptScheduleEntity.class,
        ConfigValueEntity.class,
        ApiAccessTokenEntity.class,
        AiModelProfileEntity.class,
        AiAgentProfileEntity.class,
        AiToolsetEntity.class,
        RepositoryAiPackageInstallationEntity.class,
        AiCallLogEntity.class,
        AiAgentRunEntity.class,
        AiAgentStepEntity.class,
        AiAgentApprovalEntity.class,
        SharedStateEntity.class
})
@EnableJpaRepositories(basePackageClasses = {
        SpringDataScriptEntityRepository.class,
        SpringDataExecutionEntityRepository.class,
        SpringDataPluginRegistrationRepository.class,
        SpringDataScriptScheduleEntityRepository.class,
        SpringDataConfigValueRepository.class,
        SpringDataApiAccessTokenRepository.class,
        SpringDataAiModelProfileRepository.class,
        SpringDataAiAgentProfileRepository.class,
        SpringDataAiToolsetRepository.class,
        SpringDataRepositoryAiPackageInstallationRepository.class,
        SpringDataAiCallLogRepository.class,
        SpringDataAiAgentRunRepository.class,
        SpringDataAiAgentStepRepository.class,
        SpringDataAiAgentApprovalRepository.class,
        SpringDataSharedStateRepository.class
})
@Import({RuntimeConfiguration.class, StorageConfiguration.class, AuthConfiguration.class, WebCorsConfiguration.class, ScheduleConfiguration.class})
/**
 * ActionDock 运行时应用入口。
 *
 * @author jay.wu
 */
public class RuntimeApplication {
    public static void main(String[] args) {
        if ("gui".equals(System.getProperty("jdeploy.mode", ""))) {
            javax.swing.SwingUtilities.invokeLater(() -> {
                javax.swing.JOptionPane.showMessageDialog(
                        null,
                        "ActionDock Server\n\nThis application runs as a background service.\n"
                                + "Use 'actiondock-server' in a terminal or the jDeploy service commands to manage it.",
                        "About ActionDock Server",
                        javax.swing.JOptionPane.INFORMATION_MESSAGE
                );
                System.exit(0);
            });
            return;
        }
        SpringApplication.run(RuntimeApplication.class, args);
    }
}
