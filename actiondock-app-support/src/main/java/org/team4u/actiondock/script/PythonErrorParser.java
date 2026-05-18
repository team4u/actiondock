package org.team4u.actiondock.script;

/**
 * Python 错误信息解析工具，从进程输出中提取可读的错误摘要。
 */
final class PythonErrorParser {

    private PythonErrorParser() {
    }

    static String extractErrorMessage(ProcessSupport.ProcessResult result) {
        String stderr = result.stderr() == null ? "" : result.stderr().trim();
        if (!stderr.isEmpty()) {
            return summarizePythonError(stderr);
        }
        String stdout = result.stdout() == null ? "" : result.stdout().trim();
        if (!stdout.isEmpty()) {
            return stdout;
        }
        return "Python 脚本执行失败";
    }

    static String summarizePythonError(String stderr) {
        String[] lines = stderr.split("\\R");
        for (int index = lines.length - 1; index >= 0; index -= 1) {
            String line = lines[index].trim();
            if (line.isEmpty()) {
                continue;
            }
            int separator = line.indexOf(": ");
            if (separator > 0 && separator < line.length() - 2) {
                return line.substring(separator + 2).trim();
            }
            return line;
        }
        return stderr;
    }
}
