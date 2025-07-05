import { McpClient } from './d52b35fe-d81f-4d7f-95fb-b0a582c91a9e.mjs';
import { l as logger } from '../logger.mjs';
import '@mastra/core/tools';
import 'zod';
import 'winston';

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

export { McpRegistry };
//# sourceMappingURL=8a02bc6f-832c-407d-a841-caa763907fb4.mjs.map
