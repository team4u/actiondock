package org.team4u.actiondock.desktop;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class LocalServerProbeTest {
    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void detectsActionDockServer() throws IOException {
        startServer(true);

        boolean running = new LocalServerProbe().isActionDockRunning(adminUri());

        assertThat(running).isTrue();
    }

    @Test
    void rejectsNonHealthyServer() throws IOException {
        startServer(false);

        boolean running = new LocalServerProbe().isActionDockRunning(adminUri());

        assertThat(running).isFalse();
    }

    private void startServer(boolean healthy) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/actuator/health", exchange -> {
            byte[] body = (healthy ? "{\"status\":\"UP\"}" : "{\"status\":\"DOWN\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/admin", exchange -> {
            exchange.getResponseHeaders().add("Location", "/admin/app");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.start();
    }

    private URI adminUri() {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/admin");
    }
}
