import chalk from "chalk";

type LogLevel = "info" | "warn" | "error" | "debug";

const levelPrefix: Record<LogLevel, string> = {
  info: chalk.blue("info"),
  warn: chalk.yellow("warn"),
  error: chalk.red("error"),
  debug: chalk.magenta("debug"),
};

const isDebug = () => process.env.DRIFTAL_DEBUG === "1";

function logWithPrefix(
  level: LogLevel,
  consoleFn: (...args: unknown[]) => void,
  message: unknown,
  rest: unknown[]
) {
  if (typeof message === "string") {
    consoleFn(`${levelPrefix[level]} ${message}`, ...rest);
    return;
  }

  consoleFn(levelPrefix[level], message, ...rest);
}

export const logger = {
  info(message: unknown, ...optionalParams: unknown[]) {
    if (isDebug()) {
      logWithPrefix("info", console.log, message, optionalParams);
    }
  },
  warn(message: unknown, ...optionalParams: unknown[]) {
    if (isDebug()) {
      logWithPrefix("warn", console.warn, message, optionalParams);
    }
  },
  error(message: unknown, ...optionalParams: unknown[]) {
    if (isDebug()) {
      logWithPrefix("error", console.error, message, optionalParams);
    }
  },
  debug(message: unknown, ...optionalParams: unknown[]) {
    if (isDebug()) {
      logWithPrefix("debug", console.log, message, optionalParams);
    }
  },
};
