package org.team4u.actiondock;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.team4u.actiondock.bootstrap.SampleDataInitializer;
import org.team4u.actiondock.web.common.AdminUiController;
import org.team4u.actiondock.web.execution.ExecutionController;
import org.team4u.actiondock.web.script.ScriptController;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
        classes = RuntimeApplication.class,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:web-context;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
class RuntimeApplicationContextTest {
    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoadsWebBeans() {
        assertThat(applicationContext.getBean(AdminUiController.class)).isNotNull();
        assertThat(applicationContext.getBean(ScriptController.class)).isNotNull();
        assertThat(applicationContext.getBean(ExecutionController.class)).isNotNull();
        assertThat(applicationContext.getBean("apiKeyAuthFilter")).isNotNull();
        assertThat(applicationContext.getBean(SampleDataInitializer.class)).isNotNull();
    }
}
