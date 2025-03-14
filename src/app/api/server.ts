import { z } from "zod";

import { initializeMcpApiHandler } from "@/lib/mcp-api-handler";

const handler = initializeMcpApiHandler(
  (server) => {
    // Add more tools, resources, and prompts here
    server.tool("echo", { message: z.string() }, async ({ message }) => ({
      content: [{ type: "text", text: `Tool echo: ${message}` }],
    }));
    server.tool("reverse", { text: z.string() }, async ({ text }) => ({
      content: [{ type: "text", text: text.split("").reverse().join("") }],
    }));
  },
  {
    capabilities: {
      tools: {
        echo: {
          description: "Echo a message",
        },
        reverse: {
          description: "Reverse a string",
        },
      },
    },
  },
);

export default handler;
