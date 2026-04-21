package org.team4u.scriptflow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private final Auth auth = new Auth();
    private final Execution execution = new Execution();

    public Auth getAuth() {
        return auth;
    }

    public Execution getExecution() {
        return execution;
    }

    public static class Auth {
        private List<String> apiKeys = new ArrayList<>();

        public List<String> getApiKeys() {
            return apiKeys;
        }

        public void setApiKeys(List<String> apiKeys) {
            this.apiKeys = apiKeys;
        }
    }

    public static class Execution {
        private int asyncPoolSize = 4;

        public int getAsyncPoolSize() {
            return asyncPoolSize;
        }

        public void setAsyncPoolSize(int asyncPoolSize) {
            this.asyncPoolSize = asyncPoolSize;
        }
    }
}
