package org.team4u.scriptflow.cli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StreamUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;

/**
 * ScriptFlow REST API 客户端，封装与 ScriptFlow 服务端的 HTTP 通信。
 *
 * @author jay.wu
 */
public final class ScriptFlowApiClient {
    private final CliOutput output;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    public ScriptFlowApiClient(CliConfigService.ResolvedConnectionConfig config, ObjectMapper objectMapper, CliOutput output) {
        this.output = output;
        this.objectMapper = objectMapper;
        this.restClient = createClient(config);
    }

    public JsonNode get(String path, Map<String, ?> queryParams) {
        return exchange(HttpMethod.GET, path, queryParams, null, null);
    }

    public JsonNode delete(String path, Map<String, ?> queryParams) {
        return exchange(HttpMethod.DELETE, path, queryParams, null, null);
    }

    public JsonNode postJson(String path, Map<String, ?> queryParams, String body) {
        return exchange(HttpMethod.POST, path, queryParams, body, null);
    }

    public JsonNode putJson(String path, Map<String, ?> queryParams, String body) {
        return exchange(HttpMethod.PUT, path, queryParams, body, null);
    }

    public JsonNode postMultipart(String path, Map<String, ?> queryParams, String fieldName, Path file, byte[] content) {
        LinkedMultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add(fieldName, new NamedByteArrayResource(file.getFileName().toString(), content));
        return exchange(HttpMethod.POST, path, queryParams, null, body);
    }

    private RestClient createClient(CliConfigService.ResolvedConnectionConfig config) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(config.connectTimeoutMs());
        requestFactory.setReadTimeout(config.readTimeoutMs());

        RestClient.Builder builder = RestClient.builder()
                .baseUrl(config.baseUrl())
                .requestFactory(requestFactory);
        if (config.token() != null && !config.token().isBlank()) {
            builder.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + config.token());
        }
        return builder.build();
    }

    private JsonNode exchange(HttpMethod method,
                              String path,
                              Map<String, ?> queryParams,
                              String body,
                              MultiValueMap<String, Object> multipart) {
        try {
            ResponsePayload response = request(method, path, queryParams, body, multipart);
            JsonNode parsed = parse(response.body());
            if (response.httpStatus() >= 200 && response.httpStatus() < 300) {
                if (parsed == null) {
                    throw CliException.transport(output, "Server returned a non-JSON response");
                }
                return parsed;
            }
            if (response.httpStatus() == 401) {
                if (parsed != null) {
                    throw CliException.fromServer(CliException.EXIT_CONFIG, "API key is invalid or missing", parsed);
                }
                throw CliException.config(output, "API key is invalid or missing");
            }
            if (parsed != null) {
                throw CliException.fromServer(CliException.EXIT_BUSINESS, "Server returned an error", parsed);
            }
            throw CliException.transport(
                    output,
                    "HTTP request failed",
                    objectMapper.valueToTree(Map.of("httpStatus", response.httpStatus(), "body", response.body()))
            );
        } catch (CliException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw CliException.transport(output, "HTTP request failed: " + exception.getMessage());
        }
    }

    private ResponsePayload request(HttpMethod method,
                                    String path,
                                    Map<String, ?> queryParams,
                                    String body,
                                    MultiValueMap<String, Object> multipart) {
        RestClient.RequestBodyUriSpec spec = restClient.method(method);
        RestClient.RequestHeadersSpec<?> requestSpec;
        if (multipart != null) {
            requestSpec = spec.uri(uriBuilder -> {
                        uriBuilder.path(path);
                        applyQueryParams(uriBuilder, queryParams);
                        return uriBuilder.build();
                    })
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(multipart);
        } else if (body != null) {
            requestSpec = spec.uri(uriBuilder -> {
                        uriBuilder.path(path);
                        applyQueryParams(uriBuilder, queryParams);
                        return uriBuilder.build();
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body);
        } else {
            requestSpec = spec.uri(uriBuilder -> {
                uriBuilder.path(path);
                applyQueryParams(uriBuilder, queryParams);
                return uriBuilder.build();
            });
        }

        return requestSpec.exchange((request, response) -> new ResponsePayload(
                response.getStatusCode().value(),
                readBody(response)
        ));
    }

    private void applyQueryParams(org.springframework.web.util.UriBuilder uriBuilder, Map<String, ?> queryParams) {
        if (queryParams == null) {
            return;
        }
        queryParams.forEach((key, value) -> {
            if (value != null) {
                uriBuilder.queryParam(key, value);
            }
        });
    }

    private String readBody(ClientHttpResponse response) throws IOException {
        if (response.getBody() == null) {
            return "";
        }
        return StreamUtils.copyToString(response.getBody(), StandardCharsets.UTF_8);
    }

    private JsonNode parse(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(body);
        } catch (Exception exception) {
            return null;
        }
    }

    private record ResponsePayload(int httpStatus, String body) {
    }

    private static final class NamedByteArrayResource extends ByteArrayResource {
        private final String filename;

        private NamedByteArrayResource(String filename, byte[] byteArray) {
            super(byteArray);
            this.filename = filename;
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }
}
