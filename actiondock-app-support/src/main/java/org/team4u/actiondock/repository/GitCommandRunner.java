package org.team4u.actiondock.repository;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Git 命令执行器，封装 Git 子进程的启动、超时和输出处理。
 *
 * @author jay.wu
 */
class GitCommandRunner {

    private static final long GIT_TIMEOUT_SECONDS = 60;

    static void runGit(Path workdir, List<String> command) {
        runGit(workdir, command, false);
    }

    static void runGit(Path workdir, List<String> command, boolean ignoreNothingToCommit) {
        GitResult result = executeGitCommand(workdir, command);
        if (result.exitCode() != 0 && ignoreNothingToCommit
                && result.stderr().toLowerCase(Locale.ROOT).contains("nothing to commit")) {
            return;
        }
        assertGitSuccess(result, command);
    }

    static String gitHead(Path root) {
        return runGitOutput(root, List.of("git", "-C", root.toString(), "rev-parse", "HEAD")).trim();
    }

    static String runGitOutput(Path workdir, List<String> command) {
        GitResult result = executeGitCommand(workdir, command);
        assertGitSuccess(result, command);
        return result.stdout();
    }

    private static void assertGitSuccess(GitResult result, List<String> command) {
        if (result.timedOut()) {
            throw new IllegalStateException("Git 命令超时（" + GIT_TIMEOUT_SECONDS + "s）: " + String.join(" ", command));
        }
        if (result.exitCode() != 0) {
            throw new IllegalStateException("Git 命令失败: " + String.join(" ", command) + "\n" + result.stdout() + result.stderr());
        }
    }

    private static GitResult executeGitCommand(Path workdir, List<String> command) {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(workdir.toFile());
        builder.environment().putIfAbsent("GIT_SSH_COMMAND",
                "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.ssh/known_hosts");
        try {
            Process process = builder.start();
            boolean finished = process.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            if (!finished) {
                process.destroyForcibly();
                process.waitFor();
            }
            return new GitResult(finished ? process.exitValue() : -1, stdout, stderr, !finished);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 Git 命令被中断: " + String.join(" ", command), exception);
        } catch (IOException exception) {
            throw new IllegalStateException("执行 Git 命令失败: " + String.join(" ", command), exception);
        }
    }

    record GitResult(int exitCode, String stdout, String stderr, boolean timedOut) {
    }
}
