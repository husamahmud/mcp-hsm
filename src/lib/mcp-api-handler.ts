import getRawBody from "raw-body";
import { Socket } from "node:net";
import { createClient } from "redis";
import { type IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";

import vercelJson from "../../vercel.json";

interface SerializedRequest {
  requestId: string;
  url: string;
  method: string;
  body: string;
  headers: IncomingHttpHeaders;
}

export function initializeMcpApiHandler(
  initializeServer: (server: McpServer) => void,
  serverOptions?: ServerOptions,
) {
  const maxDuration = vercelJson?.functions?.["api/server.ts"]?.maxDuration || 800;
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL environment variable is not set");
  }
  const redis = createClient({
    url: redisUrl,
    socket: {
      tls: redisUrl.startsWith("rediss://"),
      rejectUnauthorized: false,
    },
  });
  const redisPublisher = createClient({
    url: redisUrl,
    socket: {
      tls: redisUrl.startsWith("rediss://"),
      rejectUnauthorized: false,
    },
  });
  redis.on("error", (err) => console.error("Redis error", err));
  redisPublisher.on("error", (err) => console.error("Redis publisher error", err));

  const redisPromise = Promise.all([
    redis.connect().then(() => console.log("Redis client connected")),
    redisPublisher.connect().then(() => console.log("Redis publisher connected")),
  ]).catch((err) => {
    console.error("Redis connection failed:", err);
    throw err;
  });

  let servers: McpServer[] = [];

  return async function mcpApiHandler(req: IncomingMessage, res: ServerResponse) {
    console.log("Request received:", req.url);
    await redisPromise;
    const url = new URL(req.url || "", "https://example.com");

    if (url.pathname === "/sse") {
      console.log("Got new SSE connection");
      const transport = new SSEServerTransport("/message", res);
      const sessionId = transport.sessionId;
      const server = new McpServer(
        {
          name: "mcp-typescript server on vercel",
          version: "0.1.0",
        },
        serverOptions,
      );
      initializeServer(server);
      servers.push(server);

      server.server.onclose = () => {
        console.log("SSE connection closed");
        servers = servers.filter((s) => s !== server);
      };

      let logs: { type: "log" | "error"; messages: string[] }[] = [];
      function logInContext(severity: "log" | "error", ...messages: string[]) {
        logs.push({ type: severity, messages });
      }

      const handleMessage = async (message: string) => {
        console.log("Received message from Redis", message);
        logInContext("log", "Received message from Redis", message);
        const request = JSON.parse(message) as SerializedRequest;

        const req = createFakeIncomingMessage({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body,
        });
        const syntheticRes = new ServerResponse(req);
        let status = 100;
        let body = "";
        syntheticRes.writeHead = (statusCode: number) => {
          status = statusCode;
          return syntheticRes;
        };
        syntheticRes.end = (b: unknown) => {
          body = b as string;
          return syntheticRes;
        };
        await transport.handlePostMessage(req, syntheticRes);

        await redisPublisher.publish(
          `responses:${sessionId}:${request.requestId}`,
          JSON.stringify({ status, body }),
        );

        if (status >= 200 && status < 300) {
          logInContext("log", `Request ${sessionId}:${request.requestId} succeeded: ${body}`);
        } else {
          logInContext("error", `Message for ${sessionId}:${request.requestId} failed with status ${status}: ${body}`);
        }
      };

      const interval = setInterval(() => {
        for (const log of logs) {
          console[log.type].call(console, ...log.messages);
        }
        logs = [];
      }, 100);

      await redis.subscribe(`requests:${sessionId}`, handleMessage);
      console.log(`Subscribed to requests:${sessionId}`);

      let timeout: NodeJS.Timeout;
      let resolveTimeout: (value: unknown) => void;
      const waitPromise = new Promise((resolve) => {
        resolveTimeout = resolve;
        timeout = setTimeout(() => resolve("max duration reached"), (maxDuration - 5) * 1000);
      });

      async function cleanup() {
        clearTimeout(timeout);
        clearInterval(interval);
        await redis.unsubscribe(`requests:${sessionId}`, handleMessage);
        console.log("Done");
        res.statusCode = 200;
        res.end();
      }
      req.on("close", () => resolveTimeout("client hang up"));

      await server.connect(transport);
      const closeReason = await waitPromise;
      console.log(closeReason);
      await cleanup();
    } else if (url.pathname === "/message") {
      console.log("Received message");
      const body = await getRawBody(req, {
        length: req.headers["content-length"],
        encoding: "utf-8",
      });

      const sessionId = url.searchParams.get("sessionId") || "";
      if (!sessionId) {
        res.statusCode = 400;
        res.end("No sessionId provided");
        return;
      }
      const requestId = crypto.randomUUID();
      const serializedRequest: SerializedRequest = {
        requestId,
        url: req.url || "",
        method: req.method || "",
        body: body,
        headers: req.headers,
      };

      await redis.subscribe(`responses:${sessionId}:${requestId}`, (message) => {
        clearTimeout(timeout);
        const response = JSON.parse(message) as { status: number; body: string };
        res.statusCode = response.status;
        res.end(response.body);
      });

      await redisPublisher.publish(
        `requests:${sessionId}`,
        JSON.stringify(serializedRequest),
      );
      console.log(`Published requests:${sessionId}`, serializedRequest);

      const timeout = setTimeout(async () => {
        await redis.unsubscribe(`responses:${sessionId}:${requestId}`);
        res.statusCode = 408;
        res.end("Request timed out");
      }, 10 * 1000);

      res.on("close", async () => {
        clearTimeout(timeout);
        await redis.unsubscribe(`responses:${sessionId}:${requestId}`);
      });
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  };
}

interface FakeIncomingMessageOptions {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string | Buffer | object | null;
  socket?: Socket;
}

function createFakeIncomingMessage(
  options: FakeIncomingMessageOptions = {},
): IncomingMessage {
  const {
    method = "GET",
    url = "/",
    headers = {},
    body = null,
    socket = new Socket(),
  } = options;

  // Create the IncomingMessage instance
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers = headers;

  // Push the body content directly into the IncomingMessage stream
  if (body) {
    if (typeof body === "string") {
      req.push(body);
    } else if (Buffer.isBuffer(body)) {
      req.push(body);
    } else if (typeof body === "object") {
      req.push(JSON.stringify(body));
    }
    req.push(null); // Signal end of stream
  } else {
    req.push(null); // Ensure stream ends even if no body
  }

  return req;
}
