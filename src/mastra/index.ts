import { Mastra } from "@mastra/core";
import { weatherAgentWithWorkflow } from "./agents/weather";
import { weatherWorkflowWithSuspend } from "./workflows/weather";

export const mastra: Mastra = new Mastra({
  server: {
    port: 3000, // Defaults to 4111
    timeout: 10000, // Defaults to 30000 (30s)
    cors: {
      origin: ["*"], // Allow specific origins or '*' for all
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: false,
    },
    middleware: [
      // {
      //   handler: async (c, next) => {
      //     // Example: Add authentication check
      //     const authHeader = c.req.header("Authorization");
      //     if (!authHeader) {
      //       return new Response("Unauthorized", { status: 401 });
      //     }
 
      //     await next();
      //   },
      //   path: "/api/*",
      // },
      // Add a global request logger
      async (c, next) => {
        console.log(`${c.req.method} ${c.req.url}`);
        await next();
      },
    ],
  },
  agents: { weatherAgentWithWorkflow },
  workflows: { weatherWorkflowWithSuspend },
});

// const agent = mastra.getAgent('weatherAgentWithWorkflow');
// const result = await agent.generate([
//   {
//     role: 'user',
//     content: 'London',
//   },
// ]);

// console.log(result);