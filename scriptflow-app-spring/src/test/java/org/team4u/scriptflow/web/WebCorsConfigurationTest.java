package org.team4u.scriptflow.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.team4u.scriptflow.application.ScriptApplicationService;
import org.team4u.scriptflow.config.AppProperties;
import org.team4u.scriptflow.config.WebCorsConfiguration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ScriptController.class)
@Import({GlobalExceptionHandler.class, WebCorsConfiguration.class, WebCorsConfigurationTest.TestConfig.class})
class WebCorsConfigurationTest {
    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ScriptApplicationService scriptApplicationService;

    @Test
    void preflightAllowsCommonLanOrigin() throws Exception {
        mockMvc.perform(options("/api/scripts")
                        .header("Origin", "http://192.168.1.20:5173")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://192.168.1.20:5173"));
    }

    @Test
    void preflightAllowsAnyOrigin() throws Exception {
        mockMvc.perform(options("/api/scripts")
                        .header("Origin", "http://example.com:5173")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://example.com:5173"));
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AppProperties.class)
    static class TestConfig {
    }
}
