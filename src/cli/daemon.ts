import path from "path";
import { spawn, type ChildProcess } from "child_process";

import { Command } from "commander";

import { loadConfig } from "../config/loader.js";
import { IndexerClient } from "../core/indexer/client.js";
import { logger } from "../utils/logger.js";
import { resolveCloudAuth } from "../utils/cloud.js";

class DaemonManager {
  private process?: ChildProcess;

  async start(): Promise<void> {
    logger.debug("DaemonManager.start invoked");
    const config = await loadConfig();
    logger.debug("Configuration loaded for daemon start");
    const cloudAuth = resolveCloudAuth(config);
    logger.debug("Cloud authentication resolved for daemon start");

    if (config.cloud?.enabled) {
      logger.debug(
        "Cloud hosting detected; evaluating prerequisites for daemon start"
      );
      if (cloudAuth.missingIndexerConfig) {
        logger.warn(
          "Cloud hosting enabled but no API key source is configured."
        );
      }
      if (cloudAuth.missingIndexerEnvVar && !config.cloud?.api_key) {
        logger.warn(
          `Cloud hosting enabled but environment variable ${cloudAuth.missingIndexerEnvVar} is not set. Requests may fail.`
        );
      }
      if (cloudAuth.missingRedisEnvVar && !config.cloud?.api_key) {
        logger.warn(
          `Hosted Redis configured but missing secret environment variable(s): ${cloudAuth.missingRedisEnvVar}.`
        );
      }
      logger.info("Cloud hosting enabled. Daemon start is not required.");
      return;
    }

    const client = new IndexerClient(
      config.indexer_service.url,
      config.indexer_service.timeout,
      cloudAuth.indexerHeader,
      undefined
    );
    logger.debug("Indexer client instantiated for daemon start");

    if (await client.health()) {
      logger.info("Indexer service already reachable.");
      return;
    }

    const cwd = path.resolve("indexer-service");
    const python = process.env.SCOUT_PYTHON ?? "python3";
    logger.info(`Starting indexer service via ${python} from ${cwd}`);
    this.process = spawn(
      python,
      ["-m", "uvicorn", "app.main:app", "--port", "8765"],
      {
        cwd,
        detached: true,
        stdio: "ignore",
      }
    );
    logger.debug("Spawned indexer service process; awaiting health check");

    this.process.unref();
    logger.debug("Daemon process unref'ed");

    await this.waitForHealth(client);
    logger.debug("Indexer health verified after process launch");
    logger.info("Indexer service started.");
  }

  async stop(): Promise<void> {
    logger.debug("DaemonManager.stop invoked");
    const config = await loadConfig();
    logger.debug("Configuration loaded for daemon stop");
    const cloudAuth = resolveCloudAuth(config);
    logger.debug("Cloud authentication resolved for daemon stop");
    if (config.cloud?.enabled) {
      logger.debug("Cloud hosting detected; skipping local daemon stop");
      if (cloudAuth.missingIndexerConfig) {
        logger.warn(
          "Cloud hosting enabled but no API key source is configured."
        );
      }
      if (cloudAuth.missingIndexerEnvVar && !config.cloud?.api_key) {
        logger.warn(
          `Cloud hosting enabled but environment variable ${cloudAuth.missingIndexerEnvVar} is not set. Requests may fail.`
        );
      }
      if (cloudAuth.missingRedisEnvVar && !config.cloud?.api_key) {
        logger.warn(
          `Hosted Redis configured but missing secret environment variable(s): ${cloudAuth.missingRedisEnvVar}.`
        );
      }
      logger.info("Cloud hosting enabled. No local daemon to stop.");
      return;
    }
    if (this.process && !this.process.killed) {
      logger.debug("Tracked daemon process found; issuing kill signal");
      this.process.kill();
      logger.info("Indexer service stopped.");
    } else {
      logger.warn(
        "Indexer service process not tracked. Use system tools to stop."
      );
    }
  }

  async status(): Promise<void> {
    logger.debug("DaemonManager.status invoked");
    const config = await loadConfig();
    logger.debug("Configuration loaded for daemon status");
    const cloudAuth = resolveCloudAuth(config);
    logger.debug("Cloud authentication resolved for daemon status");
    const client = new IndexerClient(
      config.indexer_service.url,
      config.indexer_service.timeout,
      cloudAuth.indexerHeader,
      undefined
    );
    logger.debug("Indexer client instantiated for daemon status check");
    const healthy = await client.health();
    logger.info(`Indexer service is ${healthy ? "running" : "not reachable"}.`);
  }

  private async waitForHealth(
    client: IndexerClient,
    retries = 10
  ): Promise<void> {
    logger.debug(`Waiting for indexer health with up to ${retries} retries`);
    for (let i = 0; i < retries; i++) {
      logger.debug(`Health check attempt ${i + 1}`);
      if (await client.health()) {
        logger.debug("Indexer health check passed");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    logger.error("Indexer service failed health checks after all retries");
    throw new Error("Indexer service failed to start in time");
  }
}

export function registerDaemonCommand(program: Command): void {
  const manager = new DaemonManager();
  logger.debug("Registering daemon command handlers");

  program
    .command("daemon")
    .description("Manage indexer service")
    .argument("<action>", "start | stop | status")
    .action(async (action: string) => {
      logger.debug(`Daemon command received action: ${action}`);
      switch (action) {
        case "start":
          logger.debug("Executing daemon start action");
          await manager.start();
          break;
        case "stop":
          logger.debug("Executing daemon stop action");
          await manager.stop();
          break;
        case "status":
          logger.debug("Executing daemon status action");
          await manager.status();
          break;
        default:
          logger.error(`Unknown daemon action received: ${action}`);
          logger.error("Unknown action. Use start, stop, or status.");
      }
    });
}
