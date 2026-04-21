package org.team4u.scriptflow;

import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.team4u.scriptflow.cli.CliRootCommand;
import org.team4u.scriptflow.cli.SpringFactory;
import picocli.CommandLine;

import java.util.Arrays;

@SpringBootApplication
public class RuntimeApplication {
    public static void main(String[] args) {
        if (args.length > 0 && "cli".equalsIgnoreCase(args[0])) {
            String[] cliArgs = Arrays.copyOfRange(args, 1, args.length);
            ConfigurableApplicationContext context = new SpringApplicationBuilder(RuntimeApplication.class)
                    .web(WebApplicationType.NONE)
                    .run(cliArgs);
            int exitCode = new CommandLine(context.getBean(CliRootCommand.class), new SpringFactory(context))
                    .execute(cliArgs);
            context.close();
            System.exit(exitCode);
            return;
        }

        new SpringApplicationBuilder(RuntimeApplication.class)
                .web(WebApplicationType.SERVLET)
                .run(args);
    }
}
