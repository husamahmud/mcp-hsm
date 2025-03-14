import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import readline from "node:readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const originArg = process.argv[2] || "https://mcp-on-vercel.vercel.app";
const origin =
  originArg.startsWith("http://") || originArg.startsWith("https://")
    ? originArg
    : `https://${originArg}`;

async function main() {
  const transport = new SSEClientTransport(new URL(`${origin}/sse`));
  const client = new Client(
    { name: "example-client", version: "1.0.0" },
    { capabilities: { prompts: {}, resources: {}, tools: {} } },
  );

  await client.connect(transport);
  console.log("Connected", client.getServerCapabilities());

  // Echo tool
  const echoInput = await rl.question("Enter a message to echo: ");
  const echoRequest = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "echo", input: { message: echoInput } },
    id: 1,
  };
  const echoResult = await transport.send(echoRequest);
  console.log("Echoed:", echoResult);

  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error("Error:", err);
  rl.close();
  process.exit(1);
});
