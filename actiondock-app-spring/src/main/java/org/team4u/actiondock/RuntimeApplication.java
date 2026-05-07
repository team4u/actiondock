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
import org.team4u.actiondock.desktop.DesktopApplicationLauncher;
import org.team4u.actiondock.schedule.ScheduleConfiguration;
import org.team4u.actiondock.storage.jpa.StorageConfiguration;
import org.team4u.actiondock.storage.jpa.entity.ScriptEntity;
import org.team4u.actiondock.storage.jpa.repo.SpringDataScriptEntityRepository;

import java.util.Arrays;
import java.util.Set;

/**
 * ActionDock 运行时应用入口。
 *
 * @author jay.wu
 */
@SpringBootApplication(scanBasePackages = {
        "org.team4u.actiondock.web",
        "org.team4u.actiondock.bootstrap",
        "org.team4u.actiondock.desktop",
        "org.team4u.actiondock.schedule",
        "org.team4u.actiondock.update"
})
@EntityScan(basePackageClasses = ScriptEntity.class)
@EnableJpaRepositories(basePackageClasses = SpringDataScriptEntityRepository.class)
@Import({RuntimeConfiguration.class, StorageConfiguration.class, AuthConfiguration.class, WebCorsConfiguration.class, ScheduleConfiguration.class})
public class RuntimeApplication {
    private static final String DESKTOP_ARG = "--actiondock-desktop";
    private static final String RUNTIME_ARG = "--actiondock-runtime";
    private static final Set<String> INTERNAL_ARGS = Set.of(DESKTOP_ARG, RUNTIME_ARG);

    public static void main(String[] args) {
        if (DesktopApplicationLauncher.isGuiMode() || hasArg(args, DESKTOP_ARG)) {
            new DesktopApplicationLauncher(RuntimeApplication.class).launch(removeInternalArgs(args));
            return;
        }

        SpringApplication.run(RuntimeApplication.class, removeInternalArgs(args));
    }

    private static boolean hasArg(String[] args, String expected) {
        return args != null && Arrays.asList(args).contains(expected);
    }

    private static String[] removeInternalArgs(String[] args) {
        if (args == null || args.length == 0) {
            return args;
        }

        return Arrays.stream(args)
                .filter(arg -> !INTERNAL_ARGS.contains(arg))
                .toArray(String[]::new);
    }
}
