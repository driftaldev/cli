import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "http";
import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  JSONRPCMessageSchema,
  isInitializeRequest
} from "@modelcontextprotocol/sdk/types.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";

export interface TransportServer {
  server: Server;
  url: string;
}

export async function startHttpTransport(
  server: McpServer,
  options: { host?: string; port?: number } = {}
): Promise<TransportServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 7090;

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Missing URL");
      return;
    }

    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host ?? `${host}:${requestedPort}`}`
    );

    if (requestUrl.pathname === HEALTH_PATH) {
      if (req.method === "GET") {
        res.statusCode = 200;
        res.end("ok");
      } else {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        res.end();
      }
      return;
    }

    if (requestUrl.pathname !== MCP_PATH) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (req.method !== "POST") {
        res.statusCode = 400;
        res.end("Initialization must use POST");
        return;
      }

      const parsedBody = await readInitializationRequest(req, res);
      if (!parsedBody) {
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport!);
        },
        onsessionclosed: (closedSessionId) => {
          transports.delete(closedSessionId);
        }
      });

      await server.connect(transport);

      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("error", onError);
      reject(error);
    };
    httpServer.once("error", onError);
    httpServer.listen(requestedPort, host, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort =
    typeof address === "object" && address !== null
      ? address.port
      : requestedPort;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    server: httpServer,
    url: `http://${displayHost}:${actualPort}${MCP_PATH}`
  };
}

async function readInitializationRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<unknown | undefined> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(
        typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer)
      );
    }

    const body = Buffer.concat(chunks).toString("utf8");
    if (!body) {
      res.statusCode = 400;
      res.end("Request body is required");
      return undefined;
    }

    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed) ? parsed : [parsed];

    for (const message of messages) {
      try {
        JSONRPCMessageSchema.parse(message);
      } catch (error) {
        res.statusCode = 400;
        res.end(`Invalid JSON-RPC message: ${(error as Error).message}`);
        return undefined;
      }
    }

    const hasInitializeRequest = messages.some((message) =>
      isInitializeRequest(message)
    );

    if (!hasInitializeRequest) {
      res.statusCode = 400;
      res.end("Initialization request required");
      return undefined;
    }

    return parsed;
  } catch (error) {
    res.statusCode = 400;
    res.end(`Invalid JSON: ${(error as Error).message}`);
    return undefined;
  }
}
