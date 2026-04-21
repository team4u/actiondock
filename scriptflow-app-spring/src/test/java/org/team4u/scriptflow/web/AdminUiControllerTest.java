package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;
import org.springframework.boot.autoconfigure.thymeleaf.ThymeleafAutoConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = AdminUiController.class,
        excludeAutoConfiguration = {
                SecurityAutoConfiguration.class,
                ThymeleafAutoConfiguration.class
        }
)
class AdminUiControllerTest {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void forwardsAdminEntryToIndex() throws Exception {
        mockMvc.perform(get("/admin/scripts"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/admin/index.html"));
    }
}
