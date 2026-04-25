package org.team4u.actiondock.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CliConfigServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @TempDir
    Path tempHome;

    @Test
    void resolveUsesProfileDefaultsWhenNoOverridesExist() {
        CliConfigService service = new CliConfigService(objectMapper, Map.of(), tempHome);
        CliConfigService.ConfigFile file = new CliConfigService.ConfigFile();
        CliConfigService.ProfileConfig profile = new CliConfigService.ProfileConfig();
        profile.setBaseUrl("https://profile.example/");
        profile.setToken("profile-token");
        profile.setConnectTimeoutMs(1111);
        profile.setReadTimeoutMs(2222);
        file.setCurrentProfile("dev");
        file.getProfiles().put("dev", profile);
        service.save(file);

        CliConfigService.ResolvedConnectionConfig resolved = service.resolve(
                new CliConfigService.ResolutionRequest(null, null, null, null, null)
        );

        assertThat(resolved.profile()).isEqualTo("dev");
        assertThat(resolved.baseUrl()).isEqualTo("https://profile.example");
        assertThat(resolved.token()).isEqualTo("profile-token");
        assertThat(resolved.connectTimeoutMs()).isEqualTo(1111);
        assertThat(resolved.readTimeoutMs()).isEqualTo(2222);
        assertThat(resolved.profileSource()).isEqualTo("PROFILE_FILE");
        assertThat(resolved.baseUrlSource()).isEqualTo("PROFILE_FILE");
        assertThat(resolved.tokenSource()).isEqualTo("PROFILE_FILE");
    }

    @Test
    void resolvePrefersFlagsOverEnvironmentAndProfile() {
        CliConfigService service = new CliConfigService(objectMapper, Map.of(
                CliConfigService.ENV_PROFILE, "dev",
                CliConfigService.ENV_BASE_URL, "https://env.example/",
                CliConfigService.ENV_TOKEN, "env-token"
        ), tempHome);
        CliConfigService.ConfigFile file = new CliConfigService.ConfigFile();
        CliConfigService.ProfileConfig dev = new CliConfigService.ProfileConfig();
        dev.setBaseUrl("https://dev.example");
        dev.setToken("dev-token");
        dev.setConnectTimeoutMs(1000);
        dev.setReadTimeoutMs(2000);
        CliConfigService.ProfileConfig prod = new CliConfigService.ProfileConfig();
        prod.setBaseUrl("https://prod.example");
        prod.setToken("prod-token");
        prod.setConnectTimeoutMs(3000);
        prod.setReadTimeoutMs(4000);
        file.setCurrentProfile("dev");
        file.getProfiles().put("dev", dev);
        file.getProfiles().put("prod", prod);
        service.save(file);

        CliConfigService.ResolvedConnectionConfig resolved = service.resolve(
                new CliConfigService.ResolutionRequest("prod", "https://flag.example/", "flag-token", 999, null)
        );

        assertThat(resolved.profile()).isEqualTo("prod");
        assertThat(resolved.profileSource()).isEqualTo("FLAG");
        assertThat(resolved.baseUrl()).isEqualTo("https://flag.example");
        assertThat(resolved.baseUrlSource()).isEqualTo("FLAG");
        assertThat(resolved.token()).isEqualTo("flag-token");
        assertThat(resolved.tokenSource()).isEqualTo("FLAG");
        assertThat(resolved.connectTimeoutMs()).isEqualTo(999);
        assertThat(resolved.connectTimeoutSource()).isEqualTo("FLAG");
        assertThat(resolved.readTimeoutMs()).isEqualTo(4000);
        assertThat(resolved.readTimeoutSource()).isEqualTo("PROFILE_FILE");
    }
}
