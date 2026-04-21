package org.team4u.scriptflow.cli;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.support.StaticApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

class SpringFactoryTest {
    @Test
    void createUsesApplicationContextAutowiring() throws Exception {
        StaticApplicationContext context = new StaticApplicationContext();
        context.registerSingleton("dependency", Dependency.class);

        SpringFactory factory = new SpringFactory(context);
        NeedsDependency bean = factory.create(NeedsDependency.class);

        assertThat(bean.dependency).isNotNull();
    }

    static class Dependency {
    }

    static class NeedsDependency {
        private final Dependency dependency;

        @Autowired
        NeedsDependency(Dependency dependency) {
            this.dependency = dependency;
        }
    }
}
