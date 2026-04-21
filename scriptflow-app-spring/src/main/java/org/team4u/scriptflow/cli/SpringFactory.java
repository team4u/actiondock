package org.team4u.scriptflow.cli;

import org.springframework.context.ApplicationContext;
import picocli.CommandLine;

public class SpringFactory implements CommandLine.IFactory {
    private final ApplicationContext applicationContext;

    public SpringFactory(ApplicationContext applicationContext) {
        this.applicationContext = applicationContext;
    }

    @Override
    public <K> K create(Class<K> cls) throws Exception {
        return applicationContext.getAutowireCapableBeanFactory().createBean(cls);
    }
}
