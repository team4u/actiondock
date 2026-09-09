import { createInterface } from "node:readline";
import { ArgumentError, SigintError } from "./errors";
import type { CliContext } from "./types";

/**
 * 密码输入提示配置选项。
 */
export interface PromptPasswordOptions {
  /** 掩码字符，默认为 '*'；若传入空字符串则为完全无回显静默模式 */
  mask?: string;
  /** 自定义输入流，默认为 process.stdin */
  inputStream?: NodeJS.ReadableStream;
  /** 自定义输出流，默认为 process.stdout */
  outputStream?: NodeJS.WritableStream;
}

/**
 * 在终端中安全交互式读取用户输入的密码或敏感信息。
 * 处于 TTY 交互终端时，自动进入原始模式并打印掩码字符；退出时确保恢复终端回显。
 *
 * @param promptText 提示文案，例如 "Enter value: "
 * @param options 配置选项
 */
export async function promptPassword(
  promptText: string,
  options: PromptPasswordOptions = {}
): Promise<string> {
  const mask = options.mask ?? "*";
  const stdin = (options.inputStream || process.stdin) as NodeJS.ReadStream;
  const stdout = (options.outputStream || process.stdout) as NodeJS.WriteStream;

  // 如果并非处于交互式终端或不支持原始模式，降级为普通流式单行读取
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return readStreamLine(stdin);
  }

  return new Promise((resolve, reject) => {
    stdout.write(promptText);

    let password = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      try {
        stdin.setRawMode(false);
      } catch {
        // 忽略可能存在的终端模式恢复异常
      }
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk: string | Buffer) => {
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      for (const char of str) {
        switch (char) {
          case "\n":
          case "\r":
          case "\u0004": // Ctrl+D
            cleanup();
            stdout.write("\n");
            resolve(password);
            return;

          case "\u0003": // Ctrl+C
            cleanup();
            stdout.write("\n");
            reject(new SigintError("User cancelled input"));
            return;

          case "\u0008": // Backspace
          case "\x7f":   // Delete
            if (password.length > 0) {
              password = password.slice(0, -1);
              if (mask) {
                stdout.write("\b \b");
              }
            }
            break;

          case "\u001b": // Escape sequence
            break;

          default:
            // 过滤不可见控制字符，只追加可打印字符
            if (char.charCodeAt(0) >= 32) {
              password += char;
              if (mask) {
                stdout.write(mask);
              }
            }
            break;
        }
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * 在终端中常规交互式读取一行文本输入。
 *
 * @param promptText 提示文案
 * @param options 配置选项
 */
export async function promptText(
  promptText: string,
  options?: {
    inputStream?: NodeJS.ReadableStream;
    outputStream?: NodeJS.WritableStream;
  }
): Promise<string> {
  const input = options?.inputStream || process.stdin;
  const output = options?.outputStream || process.stdout;
  const rl = createInterface({ input, output });

  return new Promise((resolve, reject) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new SigintError("User cancelled input"));
    });
  });
}

/**
 * 从可读流中读取单行内容。
 */
export async function readStreamLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    let resolved = false;

    rl.once("line", (line) => {
      resolved = true;
      rl.close();
      resolve(line);
    });

    rl.once("close", () => {
      if (!resolved) {
        resolve("");
      }
    });

    rl.once("error", (err) => {
      rl.close();
      reject(err);
    });
  });
}

/**
 * 从流中完整读取所有数据，并移除末尾的换行符。
 */
export async function readEntireStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.once("end", () => {
      const content = Buffer.concat(chunks).toString("utf-8");
      resolve(content.replace(/[\r\n]+$/, ""));
    });
    stream.once("error", reject);
    if ("resume" in stream && typeof (stream as any).resume === "function") {
      (stream as any).resume();
    }
  });
}

/**
 * 解析并获取配置项的具体输入值。
 * 优先顺序：
 * - context.promptInput（测试或宿主环境注入）
 * - --stdin / context.stdin（标准输入流读取）
 * - 终端交互式输入（区分 secret 掩码模式与普通文本模式）
 * - 管道非 TTY 降级读取
 */
export async function resolveConfigValueInput(options: {
  promptText: string;
  secret?: boolean;
  mask?: string;
  context?: CliContext;
  useStdin?: boolean;
}): Promise<string> {
  const { promptText: queryText, secret, mask, context, useStdin } = options;
  const effectiveMask = mask ?? (secret ? "*" : undefined);

  // 1. 如果上下文注入了自定义输入函数（如测试隔离环境），优先调用
  if (context?.promptInput) {
    return await context.promptInput(queryText, { secret, mask: effectiveMask });
  }

  // 2. 如果显式指定了 --stdin 选项
  if (useStdin) {
    const stream = context?.stdin || process.stdin;
    const val = await readEntireStdin(stream);
    if (!val) {
      throw new ArgumentError("No data received from standard input");
    }
    return val;
  }

  // 3. 如果上下文提供了自定义 stdin 流
  if (context?.stdin) {
    const val = await readEntireStdin(context.stdin);
    if (!val) {
      throw new ArgumentError(
        "Value is required for config set. Omit value in an interactive terminal to enter securely, or pass via stdin."
      );
    }
    return val;
  }

  // 4. 判断是否处于交互式终端设备
  const isTty = Boolean(process.stdin.isTTY && typeof process.stdin.setRawMode === "function");

  if (isTty) {
    if (secret) {
      return await promptPassword(queryText, { mask: effectiveMask });
    }
    return await promptText(queryText);
  }

  // 5. 非交互式终端环境（例如管道输入 echo "val" | ad config set key）
  const val = await readEntireStdin(process.stdin);
  if (!val) {
    throw new ArgumentError(
      "Value is required for config set. Omit value in an interactive terminal to enter securely, or pass via stdin."
    );
  }
  return val;
}
