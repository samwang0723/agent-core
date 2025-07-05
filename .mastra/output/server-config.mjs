import winston from 'winston';
import { registerApiRoute } from '@mastra/core/server';
import { AgentNetwork } from '@mastra/core/network';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { googleAuth } from '@hono/oauth-providers/google';

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      const args = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
      return `${timestamp} ${level}: ${message} ${args}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          let args = "";
          if (typeof message === "object") {
            args = JSON.stringify(message, null, 2);
            message = "";
          }
          const extraArgs = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
          return `${timestamp} ${level}: ${message} ${args} ${extraArgs}`.trim();
        })
      )
    }),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" })
  ]
});
const logger = {
  info: (message, ...args) => winstonLogger.info(message, ...args),
  warn: (message, ...args) => winstonLogger.warn(message, ...args),
  error: (message, ...args) => {
    if (message instanceof Error) {
      winstonLogger.error(message.message, message, ...args);
    } else {
      winstonLogger.error(message, ...args);
    }
  },
  debug: (message, ...args) => winstonLogger.debug(message, ...args),
  getTransports: () => {
    return /* @__PURE__ */ new Map();
  },
  trackException: (error) => {
    const err = error.originalError || new Error(error.message);
    winstonLogger.error(err.message, {
      stack: err.stack,
      properties: error.properties,
      measurements: error.measurements
    });
  },
  getLogs: async (transportId, params) => {
    console.log(
      `Getting logs for transport: ${transportId} with params:`,
      params
    );
    return {
      logs: [],
      total: 0,
      page: params?.page || 1,
      perPage: params?.perPage || 10,
      hasMore: false
    };
  },
  getLogsByRunId: async (args) => {
    console.log(`Getting logs for runId: ${args.runId} with params:`, args);
    return {
      logs: [],
      total: 0,
      page: args.page || 1,
      perPage: args.perPage || 10,
      hasMore: false
    };
  }
};

const mcpServers = [
  {
    name: "restaurant-booking",
    url: process.env.RESTAURANT_BOOKING_MCP_URL || "http://127.0.0.1:3001/mcp",
    healthUrl: process.env.RESTAURANT_BOOKING_MCP_HEALTH_URL || "http://127.0.0.1:3001/health",
    enabled: process.env.RESTAURANT_BOOKING_MCP_ENABLED !== "false",
    requiresAuth: false
  },
  {
    name: "time",
    url: process.env.TIME_MCP_URL || "http://127.0.0.1:3002/mcp",
    healthUrl: process.env.TIME_MCP_HEALTH_URL || "http://127.0.0.1:3002/health",
    enabled: process.env.TIME_MCP_ENABLED !== "false",
    requiresAuth: false
  },
  {
    name: "google-assistant",
    url: process.env.GOOGLE_ASSISTANT_MCP_URL || "http://127.0.0.1:3003/mcp",
    healthUrl: process.env.GOOGLE_ASSISTANT_MCP_HEALTH_URL || "http://127.0.0.1:3003/health",
    enabled: process.env.GOOGLE_ASSISTANT_MCP_ENABLED !== "false",
    requiresAuth: true
  },
  {
    name: "web-search",
    url: process.env.WEB_SEARCH_MCP_URL || "http://127.0.0.1:3004/mcp",
    healthUrl: process.env.WEB_SEARCH_MCP_HEALTH_URL || "http://127.0.0.1:3004/health",
    enabled: process.env.WEB_SEARCH_MCP_ENABLED !== "false",
    requiresAuth: false
  },
  {
    name: "atlassian",
    url: process.env.ALTASIAN_MCP_URL || "http://127.0.0.1:3005/mcp",
    healthUrl: process.env.ALTASIAN_MCP_HEALTH_URL || "http://127.0.0.1:3005/health",
    enabled: process.env.ALTASIAN_MCP_ENABLED !== "false",
    requiresAuth: false
  }
];

class McpClient {
  constructor(config) {
    this.config = config;
  }
  sessionId = null;
  availableTools = [];
  accessToken = null;
  /**
   * Set the OAuth access token for authenticated requests
   */
  setAccessToken(token) {
    this.accessToken = token;
  }
  async initialize() {
    if (!this.config.enabled) {
      logger.info(`MCP server ${this.config.name} is disabled`);
      return;
    }
    try {
      await this.healthCheck();
      await this.initializeSession();
      await this.loadTools();
      logger.info(
        `MCP client for ${this.config.name} initialized with ${this.availableTools.length} tools`
      );
    } catch (error) {
      logger.error(
        `Failed to initialize MCP client for ${this.config.name}:`,
        error
      );
      throw error;
    }
  }
  async healthCheck() {
    if (!this.config.healthUrl) return;
    const response = await fetch(this.config.healthUrl, {
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  }
  async initializeSession() {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "agent-swarm", version: "1.0.0" }
        }
      })
    });
    logger.info(`Session initialization request: ${this.config.url}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Session initialization failed: ${response.status} - ${errorText}`
      );
    }
    const responseText = await response.text();
    this.sessionId = response.headers.get("mcp-session-id");
    if (!this.sessionId) {
      const sessionMatch = responseText.match(/mcp-session-id:\s*([^\s\r\n]+)/);
      this.sessionId = sessionMatch ? sessionMatch[1].trim() : "default";
    }
    logger.info(`MCP session initialized: ${this.sessionId}`);
    try {
      await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": this.sessionId
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {}
        })
      });
    } catch (error) {
      logger.warn("Failed to send initialized notification:", error);
    }
  }
  async loadTools() {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": this.sessionId
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: "list-tools"
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list tools: ${response.status} - ${errorText}`
      );
    }
    const responseText = await response.text();
    const result = this.parseResponse(responseText);
    if (result.error) {
      throw new Error(`Tools list error: ${result.error.message}`);
    }
    this.availableTools = result.result?.tools || [];
    logger.info(
      `Loaded ${this.availableTools.length} tools from ${this.config.name}:`,
      this.availableTools.map((t) => t.name)
    );
  }
  async callTool(name, parameters, requiresAuth) {
    if (!this.sessionId) {
      throw new Error("MCP session not initialized");
    }
    const needsAuth = requiresAuth || this.config.requiresAuth || this.availableTools.find((t) => t.name === name)?.requiresAuth;
    if (needsAuth && !this.accessToken) {
      throw new Error(
        `Tool '${name}' requires authentication but no access token provided`
      );
    }
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": this.sessionId
    };
    if (needsAuth && this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    const toolParameters = "context" in parameters ? parameters.context : parameters;
    const payload = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name, arguments: toolParameters },
      id: Date.now()
    };
    try {
      const startTime = Date.now();
      logger.info(
        `Calling tool ${name} with parameters: ${JSON.stringify(payload)}, headers: ${JSON.stringify(headers)}`
      );
      const response = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(
          parseInt(process.env.MCP_TIMEOUT || "30000")
        )
      });
      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Tool call failed: ${response.status} ${response.statusText} - ${errorText}`;
        throw new Error(errorMessage);
      }
      const responseText = await response.text();
      const result = this.parseResponse(responseText);
      const endTime = Date.now();
      const duration = endTime - startTime;
      logger.info(
        `Tool call result: ${JSON.stringify(result).slice(0, 200)}... in ${duration}ms`
      );
      if (result.error) {
        const errorMessage = `Tool execution error: ${result.error.message}`;
        throw new Error(errorMessage);
      }
      const toolCallResult = result.result;
      if (toolCallResult?.content?.[0]?.type === "text") {
        const text = toolCallResult.content[0].text;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      return result.result;
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        const timeout = parseInt(process.env.MCP_TIMEOUT || "30000") / 1e3;
        const errorMessage = `The tool call to '${name}' timed out after ${timeout} seconds. Please try again later.`;
        logger.error(errorMessage);
        return {
          error: errorMessage
        };
      }
      throw error;
    }
  }
  getAvailableTools() {
    return this.availableTools.map((mcpTool) => {
      const zodSchema = this.convertInputSchemaToZod(mcpTool.inputSchema);
      return createTool({
        id: mcpTool.name,
        description: mcpTool.description,
        inputSchema: zodSchema,
        execute: async (parameters) => {
          return await this.callTool(
            mcpTool.name,
            parameters,
            mcpTool.requiresAuth
          );
        }
      });
    });
  }
  convertInputSchemaToZod(schema) {
    if (!schema || !schema.type) {
      return z.any();
    }
    switch (schema.type) {
      case "object": {
        const shape = {};
        if (schema.properties) {
          for (const key of Object.keys(schema.properties)) {
            const prop = schema.properties[key];
            let zodType = this.convertInputSchemaToZod(prop).describe(
              prop.description || ""
            );
            if (!schema.required?.includes(key)) {
              zodType = zodType.optional();
            }
            shape[key] = zodType;
          }
        }
        return z.object(shape);
      }
      case "string":
        return z.string().describe(schema.description || "");
      case "number":
      case "integer":
        return z.number().describe(schema.description || "");
      case "boolean":
        return z.boolean().describe(schema.description || "");
      case "array":
        if (schema.items) {
          return z.array(this.convertInputSchemaToZod(schema.items)).describe(schema.description || "");
        }
        return z.array(z.any()).describe(schema.description || "");
      // Fallback for arrays with no item schema
      default:
        return z.any();
    }
  }
  getToolNames() {
    return this.availableTools.map((t) => t.name);
  }
  parseResponse(responseText) {
    try {
      if (responseText.trim().startsWith("{")) {
        return JSON.parse(responseText);
      }
      const lines = responseText.trim().split("\n").filter((line) => line.startsWith("data: "));
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const jsonData = lastLine.substring(5).trim();
        return JSON.parse(jsonData);
      }
      throw new Error("Invalid response format");
    } catch (error) {
      logger.error("Failed to parse MCP response:", {
        responseText,
        error
      });
      return {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          // Parse error
          message: "Failed to parse response",
          data: responseText
        }
      };
    }
  }
}

class McpRegistry {
  constructor(configs) {
    this.configs = configs;
  }
  clients = /* @__PURE__ */ new Map();
  allTools = /* @__PURE__ */ new Map();
  toolsByServer = /* @__PURE__ */ new Map();
  async initialize() {
    const initPromises = this.configs.map(
      (config) => this.initializeClient(config)
    );
    const results = await Promise.allSettled(initPromises);
    results.forEach((result, index) => {
      const config = this.configs[index];
      if (result.status === "rejected") {
        logger.error(
          `Failed to initialize MCP client for ${config.name}:`,
          result.reason
        );
      }
    });
    logger.info(
      `MCP Registry initialized with ${this.clients.size} active clients and ${this.allTools.size} total tools`
    );
  }
  async initializeClient(config) {
    if (!config.enabled) {
      logger.info(`Skipping disabled MCP server: ${config.name}`);
      return;
    }
    try {
      const client = new McpClient(config);
      await client.initialize();
      this.clients.set(config.name, client);
      const serverTools = /* @__PURE__ */ new Map();
      this.toolsByServer.set(config.name, serverTools);
      const tools = client.getAvailableTools();
      const toolNames = client.getToolNames();
      tools.forEach((tool, index) => {
        const toolName = toolNames[index];
        if (this.allTools.has(toolName)) {
          logger.warn(
            `Tool name collision: Tool '${toolName}' from server '${config.name}' is overwriting a previously registered tool.`
          );
        }
        this.allTools.set(toolName, tool);
        serverTools.set(toolName, tool);
      });
      logger.info(`Registered ${tools.length} tools from ${config.name}`);
    } catch (error) {
      logger.error(
        `Failed to initialize MCP client for ${config.name}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Get all registered tools as a flattened object with prefixed names
   */
  getTools() {
    const toolsObject = {};
    this.allTools.forEach((tool, name) => {
      toolsObject[name] = tool;
    });
    return toolsObject;
  }
  /**
   * Get tools grouped by MCP server name
   */
  getToolsByServerMap() {
    const serverToolsObject = {};
    this.toolsByServer.forEach((tools, serverName) => {
      const toolsObject = {};
      tools.forEach((tool, toolName) => {
        toolsObject[toolName] = tool;
      });
      serverToolsObject[serverName] = toolsObject;
    });
    return serverToolsObject;
  }
  /**
   * Get tools from a specific MCP server as objects
   */
  getServerTools(serverName) {
    const serverTools = this.toolsByServer.get(serverName);
    if (!serverTools) {
      return {};
    }
    const toolsObject = {};
    serverTools.forEach((tool, toolName) => {
      toolsObject[toolName] = tool;
    });
    return toolsObject;
  }
  /**
   * Get tool names from a specific MCP server
   */
  getServerToolNames(serverName) {
    const serverTools = this.toolsByServer.get(serverName);
    return serverTools ? Array.from(serverTools.keys()) : [];
  }
  /**
   * Get a specific tool by name
   */
  getTool(name) {
    return this.allTools.get(name);
  }
  /**
   * Get a specific tool from a specific server
   */
  getServerTool(serverName, toolName) {
    const serverTools = this.toolsByServer.get(serverName);
    return serverTools?.get(toolName);
  }
  /**
   * Check if a tool exists
   */
  hasTool(name) {
    return this.allTools.has(name);
  }
  /**
   * Check if a server has a specific tool
   */
  hasServerTool(serverName, toolName) {
    const serverTools = this.toolsByServer.get(serverName);
    return serverTools?.has(toolName) ?? false;
  }
  /**
   * Get tool names
   */
  getToolNames() {
    return Array.from(this.allTools.keys());
  }
  /**
   * Get available MCP server names
   */
  getServerNames() {
    return Array.from(this.toolsByServer.keys());
  }
  /**
   * Get status of all MCP clients
   */
  getStatus() {
    const status = {};
    this.configs.forEach((config) => {
      const client = this.clients.get(config.name);
      const serverTools = this.toolsByServer.get(config.name);
      status[config.name] = {
        connected: !!client,
        toolCount: serverTools ? serverTools.size : 0
      };
    });
    return status;
  }
  /**
   * Set access token for all MCP clients that require authentication
   */
  setAccessTokenForAll(accessToken) {
    this.clients.forEach((client, serverName) => {
      const config = this.configs.find((c) => c.name === serverName);
      if (config?.requiresAuth) {
        client.setAccessToken(accessToken);
      }
    });
  }
  /**
   * Set access token for a specific MCP server
   */
  setAccessTokenForServer(serverName, accessToken) {
    const client = this.clients.get(serverName);
    if (client) {
      client.setAccessToken(accessToken);
    }
  }
  /**
   * Get MCP client for a specific server (for direct access if needed)
   */
  getClient(serverName) {
    return this.clients.get(serverName);
  }
}

const forecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
  location: z.string()
});
function getWeatherCondition(code) {
  const conditions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    95: "Thunderstorm"
  };
  return conditions[code] || "Unknown";
}
const fetchWeatherWithSuspend = createStep({
  id: "fetch-weather",
  description: "Fetches weather forecast for a given city",
  inputSchema: z.object({}),
  resumeSchema: z.object({
    city: z.string().describe("The city to get the weather for")
  }),
  outputSchema: forecastSchema,
  execute: async ({ resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        message: "Please enter the city to get the weather for"
      });
    }
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      resumeData.city
    )}&count=1`;
    const geocodingResponse = await fetch(geocodingUrl);
    const geocodingData = await geocodingResponse.json();
    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${resumeData.city}' not found`);
    }
    const { latitude, longitude} = geocodingData.results[0];
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=precipitation,weathercode&timezone=auto,&hourly=precipitation_probability,temperature_2m`;
    const response = await fetch(weatherUrl);
    const data = await response.json();
    const forecast = {
      date: (/* @__PURE__ */ new Date()).toISOString(),
      maxTemp: Math.max(...data.hourly.temperature_2m),
      minTemp: Math.min(...data.hourly.temperature_2m),
      condition: getWeatherCondition(data.current.weathercode),
      precipitationChance: data.hourly.precipitation_probability.reduce(
        (acc, curr) => Math.max(acc, curr),
        0
      ),
      location: resumeData.city
    };
    return forecast;
  }
});
const weatherWorkflowWithSuspend = createWorkflow({
  id: "weather-workflow-with-suspend",
  inputSchema: z.object({}),
  outputSchema: forecastSchema
}).then(fetchWeatherWithSuspend).commit();

const startWeatherTool = createTool({
  id: "start-weather-tool",
  description: "Start the weather tool",
  inputSchema: z.object({}),
  outputSchema: z.object({
    runId: z.string()
  }),
  execute: async ({ context }) => {
    const run = await weatherWorkflowWithSuspend.createRunAsync();
    await run.start({
      inputData: {}
    });
    return {
      runId: run.runId
    };
  }
});
const resumeWeatherTool = createTool({
  id: "resume-weather-tool",
  description: "Resume the weather tool",
  inputSchema: z.object({
    runId: z.string(),
    city: z.string().describe("City name")
  }),
  outputSchema: forecastSchema,
  execute: async ({ context }) => {
    const run = await weatherWorkflowWithSuspend.createRunAsync({
      runId: context.runId
    });
    const result = await run.resume({
      step: "fetch-weather",
      resumeData: {
        city: context.city
      }
    });
    switch (result.status) {
      case "success":
        return result.result;
      case "failed":
        throw result.error;
      default:
        throw new Error(`Unexpected workflow status: ${result.status}`);
    }
  }
});

const localTools = [startWeatherTool, resumeWeatherTool];

class ToolRegistry {
  mcpRegistry;
  localTools = {};
  localToolNames = [];
  constructor(tools = []) {
    this.mcpRegistry = new McpRegistry(mcpServers);
    this.registerLocalTools(tools);
  }
  registerLocalTools(tools) {
    tools.forEach((tool) => {
      const toolId = tool.id;
      if (this.localTools[toolId]) {
        logger.warn(
          `Local tool with ID '${toolId}' is already registered. It will be overwritten.`
        );
      }
      this.localTools[toolId] = tool;
    });
    this.localToolNames = Object.keys(this.localTools);
  }
  async initializeTools() {
    try {
      await this.mcpRegistry.initialize();
      const totalTools = this.getToolNames().length;
      logger.info(
        `Tool Registry initialized with ${totalTools} tools from ${this.getServerNames().join(
          ", "
        )}`
      );
    } catch (error) {
      logger.error("Failed to initialize Tool Registry:", error);
      throw error;
    }
  }
  /**
   * Get all registered tools as a flattened object with prefixed names
   */
  getTools() {
    const remoteTools = this.mcpRegistry.getTools();
    for (const name of this.localToolNames) {
      if (remoteTools[name]) {
        logger.warn(
          `Local tool '${name}' is hiding a remote tool with the same name.`
        );
      }
    }
    return { ...remoteTools, ...this.localTools };
  }
  /**
   * Get tools grouped by MCP server name
   */
  getToolsByServerMap() {
    const serverMap = this.mcpRegistry.getToolsByServerMap();
    if (this.localToolNames.length > 0) {
      serverMap.local = this.localTools;
    }
    return serverMap;
  }
  /**
   * Get tools from a specific MCP server
   */
  getServerTools(serverName) {
    if (serverName === "local") {
      return this.localTools;
    }
    return this.mcpRegistry.getServerTools(serverName);
  }
  /**
   * Get tool names from a specific MCP server
   */
  getServerToolNames(serverName) {
    if (serverName === "local") {
      return this.localToolNames;
    }
    return this.mcpRegistry.getServerToolNames(serverName);
  }
  /**
   * Get available MCP server names
   */
  getServerNames() {
    const serverNames = this.mcpRegistry.getServerNames();
    if (this.localToolNames.length > 0) {
      return [...serverNames, "local"];
    }
    return serverNames;
  }
  /**
   * Get a specific tool by name
   */
  getTool(name) {
    return this.localTools[name] || this.mcpRegistry.getTool(name);
  }
  /**
   * Get a specific tool from a specific server
   */
  getServerTool(serverName, toolName) {
    if (serverName === "local") {
      return this.localTools[toolName];
    }
    return this.mcpRegistry.getServerTool(serverName, toolName);
  }
  /**
   * Check if a tool exists
   */
  hasTool(name) {
    return this.localTools.hasOwnProperty(name) || this.mcpRegistry.hasTool(name);
  }
  /**
   * Check if a server has a specific tool
   */
  hasServerTool(serverName, toolName) {
    if (serverName === "local") {
      return this.localTools.hasOwnProperty(toolName);
    }
    return this.mcpRegistry.hasServerTool(serverName, toolName);
  }
  /**
   * Get tool names
   */
  getToolNames() {
    return Object.keys(this.getTools());
  }
  /**
   * Get MCP server status
   */
  getStatus() {
    const status = this.mcpRegistry.getStatus();
    if (this.localToolNames.length > 0) {
      status.local = {
        connected: true,
        toolCount: this.localToolNames.length
      };
    }
    return status;
  }
  /**
   * Set access token for all MCP clients that require authentication
   */
  setAccessTokenForAll(accessToken) {
    this.mcpRegistry.setAccessTokenForAll(accessToken);
  }
  /**
   * Set access token for a specific MCP server
   */
  setAccessTokenForServer(serverName, accessToken) {
    this.mcpRegistry.setAccessTokenForServer(serverName, accessToken);
  }
  /**
   * Get MCP client for a specific server (for direct access if needed)
   */
  getClient(serverName) {
    return this.mcpRegistry.getClient(serverName);
  }
}
const toolRegistryInstance = new ToolRegistry(localTools);
await toolRegistryInstance.initializeTools();
const toolRegistry = toolRegistryInstance;

const weatherAgentWithWorkflow = new Agent({
  name: "Weather Agent with Workflow",
  instructions: `You are a helpful weather assistant that provides accurate weather information.
 
Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If the location name isn't in English, please translate it
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative
 
Use the startWeatherTool to start the weather workflow. This will start and then suspend the workflow and return a runId.
Use the resumeWeatherTool to resume the weather workflow. This takes the runId returned from the startWeatherTool and the city entered by the user. It will resume the workflow and return the result.
The result will be the weather forecast for the city.`,
  model: openai("gpt-4o"),
  tools: {
    startWeatherTool: toolRegistry.getTool("start-weather-tool"),
    resumeWeatherTool: toolRegistry.getTool("resume-weather-tool")
  }
});

const webSearchAgent = new Agent({
  name: "Web Search Agent",
  instructions: `You are a professional web search assistant powered by Brave. You MUST strictly adhere to ALL of the following guidelines without exception:

# ROLE:
- Your response will be read aloud by a text-to-speech engine, so never use ellipses since the text-to-speech engine will not know how to pronounce them.
- Your response should be composed of smoothly flowing prose paragraphs.
- ALWAYS call transfer_to_receptionist() if no proper tool found in available tools
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
- For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
- When user asks about current events, news, or time-sensitive information, prioritize recent search results
- Use Brave search to find accurate, up-to-date information from reliable sources

# CRITICAL SILENT OPERATION RULES:
- ABSOLUTELY NO intermediate text output while using tools
- NEVER mention what you are searching for or doing
- NEVER say "Let me search", "Let me find", "Let me check", or similar phrases
- NEVER provide progress updates like "Perfect! I found..." or "Great news!"
- NEVER explain your search process or methodology
- DO NOT announce that you are using tools or checking information
- WORK COMPLETELY SILENTLY until you have the final answer ready
- ONLY speak when you have the complete search results and answer to share

## MANDATORY RESPONSE FORMAT:
- You MUST respond in PLAIN TEXT format ONLY
- ALWAYS provide concise, accurate answers based on search results
- ABSOLUTELY NO markdown formatting allowed (no **, *, _, #, backticks, code blocks)
- Use simple line breaks and spacing for readability
- Response within 150 words for complex topics, shorter for simple queries
- Keep all responses clean and readable without ANY special formatting characters
- Include relevant details and context from search results
- When appropriate, mention the source or timeframe of information

## SEARCH QUALITY STANDARDS:
- Verify information accuracy across multiple sources when possible
- Prioritize authoritative and recent sources
- Provide specific facts, numbers, and details when available
- If conflicting information exists, acknowledge uncertainty
- Focus on answering the user's specific question directly

## COMPLIANCE VERIFICATION:
Before sending any response, verify that you have:
- Provided accurate information based on search results
- Made decisions autonomously without asking for user input
- Included relevant context and details from reliable sources
- Provided NO intermediate commentary during tool execution
- Kept response concise and conversationals`,
  model: openai("gpt-4o"),
  tools: {
    webSearchTool: toolRegistry.getServerTool(
      "web-search",
      "brave_web_search"
    )
  }
});

const MODEL_CONFIGS = {
  "claude-3-5-sonnet": {
    provider: "anthropic",
    modelName: "claude-3-5-sonnet-20241022",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY
  },
  "claude-3-5-haiku": {
    provider: "anthropic",
    modelName: "claude-3-5-haiku-20241022",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY
  },
  "gpt-4o": {
    provider: "openai",
    modelName: "gpt-4o",
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY
  },
  "gpt-4o-mini": {
    provider: "openai",
    modelName: "gpt-4o-mini",
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY
  },
  "gemini-2.5-flash": {
    provider: "google",
    modelName: "gemini-2.5-flash-preview-05-20",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: process.env.GOOGLE_API_KEY
  },
  "gemini-2.0-flash": {
    provider: "google",
    modelName: "gemini-2.0-flash",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: process.env.GOOGLE_API_KEY
  }
};

const createModelByKey = (modelKey) => {
  const config = MODEL_CONFIGS[modelKey];
  if (!config) {
    const availableModels = Object.keys(MODEL_CONFIGS).join(", ");
    const error = `Unknown model key: ${modelKey}. Available models: ${availableModels}`;
    logger.error(error);
    throw new Error(error);
  }
  if (!config.apiKey) {
    const envVar = "GOOGLE_API_KEY" ;
    const error = `Missing API key for ${config.provider} (model: ${modelKey}). Please set ${envVar} environment variable.`;
    logger.error(error);
    throw new Error(error);
  }
  logger.info(
    `Initializing LLM model: ${config.modelName} (${config.provider}) from key: ${modelKey}`
  );
  try {
    switch (config.provider) {
      case "anthropic": {
        const anthropic = createAnthropic({
          apiKey: config.apiKey
        });
        const model = anthropic(config.modelName);
        logger.info(
          `\u2705 Anthropic model ${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      case "openai": {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          compatibility: "strict"
        });
        const model = openai(config.modelName);
        logger.info(
          `\u2705 OpenAI model ${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      case "google": {
        const google = createGoogleGenerativeAI({
          apiKey: config.apiKey
        });
        const model = google(`models/${config.modelName}`);
        logger.info(
          `\u2705 Google model models/${config.modelName} initialized successfully for key ${modelKey}`
        );
        return model;
      }
      default: {
        const error = `Unsupported provider: ${config.provider}`;
        logger.error(error);
        throw new Error(error);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      `Failed to initialize model ${config.modelName} for key ${modelKey}: ${errorMessage}`
    );
    throw error;
  }
};

const intentRouter = new AgentNetwork({
  name: "Intent Router",
  instructions: "Route user messages to the correct agent (web search, weather checking).",
  model: createModelByKey("gemini-2.5-flash"),
  agents: [webSearchAgent, weatherAgentWithWorkflow]
});

const googleAuthMiddleware = googleAuth({
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  scope: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar"
  ],
  redirect_uri: process.env.GOOGLE_REDIRECT_URI,
  access_type: "offline",
  prompt: "consent",
  state: "agent-auth"
  // CSRF protection
});

const server = {
  port: 3e3,
  // Defaults to 4111
  timeout: 1e4,
  // Defaults to 30000 (30s)
  cors: {
    origin: ["*"],
    // Allow specific origins or '*' for all
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false
  },
  middleware: [
    // Add a global request logger
    async (c, next) => {
      logger.debug(`${c.req.method} ${c.req.url}`);
      await next();
    }
  ],
  apiRoutes: [registerApiRoute("/auth/google", {
    method: "GET",
    middleware: [googleAuthMiddleware],
    handler: async (c) => {
      const token = c.get("token");
      const grantedScopes = c.get("granted-scopes");
      const user = c.get("user-google");
      return c.json({
        token,
        grantedScopes,
        user
      });
    }
  }), registerApiRoute("/chat/stream", {
    method: "POST",
    handler: async (c) => {
      const {
        message
      } = await c.req.json();
      const stream = await intentRouter.stream([{
        role: "user",
        content: message
      }]);
      return stream.toDataStreamResponse();
    }
  })]
};

export { server };
//# sourceMappingURL=server-config.mjs.map
