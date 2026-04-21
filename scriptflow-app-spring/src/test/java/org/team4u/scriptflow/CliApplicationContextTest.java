package org.team4u.scriptflow;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.team4u.scriptflow.auth.AuthConfiguration;
import org.team4u.scriptflow.bootstrap.SampleDataInitializer;
import org.team4u.scriptflow.cli.CliRootCommand;
import org.team4u.scriptflow.config.WebCorsConfiguration;
import org.team4u.scriptflow.web.AdminUiController;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
        classes = CliApplication.class,
        properties = {
                "spring.config.name=does-not-exist",
                "spring.main.web-application-type=none",
                "spring.datasource.url=jdbc:h2:mem:cli-context;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "app.execution.async-pool-size=1"
        }
)
class CliApplicationContextTest {
    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoadsCliBeansWithoutWebArtifacts() {
        assertThat(applicationContext.getBean(CliRootCommand.class)).isNotNull();
        assertThat(applicationContext.getBeansOfType(AdminUiController.class)).isEmpty();
        assertThat(applicationContext.getBeansOfType(WebCorsConfiguration.class)).isEmpty();
        assertThat(applicationContext.getBeansOfType(AuthConfiguration.class)).isEmpty();
        assertThat(applicationContext.getBeansOfType(SampleDataInitializer.class)).isEmpty();
    }
}
