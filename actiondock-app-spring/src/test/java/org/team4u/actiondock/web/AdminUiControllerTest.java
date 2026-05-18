package org.team4u.actiondock.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.actiondock.RuntimeApplication;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = RuntimeApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                "spring.config.name=does-not-exist",
                "server.port=0",
                "spring.datasource.url=jdbc:h2:mem:admin-ui-controller;DB_CLOSE_DELAY=-1",
                "spring.datasource.driver-class-name=org.h2.Driver",
                "spring.datasource.username=sa",
                "spring.jpa.hibernate.ddl-auto=create-drop",
                "spring.jpa.open-in-view=false",
                "spring.h2.console.enabled=false",
                "app.execution.async-pool-size=1"
        }
)
@AutoConfigureMockMvc
class AdminUiControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void redirectsBareAdminToApp() throws Exception {
        mockMvc.perform(get("/admin"))
                .andExpect(status().isFound())
                .andExpect(redirectedUrl("/admin/app"));
    }

    @Test
    void redirectsAdminTrailingSlashToApp() throws Exception {
        mockMvc.perform(get("/admin/"))
                .andExpect(status().isFound())
                .andExpect(redirectedUrl("/admin/app"));
    }

    @Test
    void forwardsAppRootToIndex() throws Exception {
        mockMvc.perform(get("/admin/app"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/admin/index.html"));
    }

    @Test
    void forwardsAppDeepRouteToIndex() throws Exception {
        mockMvc.perform(get("/admin/app/scripts/my-script-id"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/admin/index.html"));
    }

    @Test
    void forwardsAppRunRouteToIndex() throws Exception {
        mockMvc.perform(get("/admin/app/run/hello-groovy"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/admin/index.html"));
    }
}
