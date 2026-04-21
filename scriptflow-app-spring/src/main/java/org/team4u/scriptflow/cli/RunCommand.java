package org.team4u.scriptflow.cli;

import org.springframework.stereotype.Component;
import org.team4u.scriptflow.application.ExecutionApplicationService;
import org.team4u.scriptflow.domain.model.ExecutionRecord;
import org.team4u.scriptflow.domain.model.SubmitMode;
import org.team4u.scriptflow.domain.port.JsonCodec;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.util.Map;

@Component
@Command(name = "run")
public class RunCommand implements Runnable {
    private final ExecutionApplicationService service;
    private final JsonCodec jsonCodec;

    @Option(names = "--id", required = true)
    String id;

    @Option(names = "--input", defaultValue = "{}")
    String input;

    @Option(names = "--async", defaultValue = "false")
    boolean async;

    public RunCommand(ExecutionApplicationService service, JsonCodec jsonCodec) {
        this.service = service;
        this.jsonCodec = jsonCodec;
    }

    @Override
    public void run() {
        Map<String, Object> payload = jsonCodec.readMap(input);
        ExecutionRecord record = service.execute(id, payload, async ? SubmitMode.ASYNC : SubmitMode.SYNC);
        System.out.println(jsonCodec.write(record.getDisplayOutput().isEmpty() ? Map.of(
                "executionId", record.getId(),
                "status", record.getStatus().name(),
                "errorMessage", record.getErrorMessage()
        ) : record.getDisplayOutput()));
    }
}
