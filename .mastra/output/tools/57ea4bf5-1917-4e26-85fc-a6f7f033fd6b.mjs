import { l as logger } from '../logger.mjs';
import { mcpServers } from './92bc2908-9d94-49ad-a4c4-06102fe95d05.mjs';
import { localTools } from './b8d0f762-f904-4d94-9122-ab95817ff1e7.mjs';
import { McpRegistry } from './8a02bc6f-832c-407d-a841-caa763907fb4.mjs';
import 'winston';
import '../weather.mjs';
import '@mastra/core/tools';
import 'zod';
import '@mastra/core/workflows';
import './d52b35fe-d81f-4d7f-95fb-b0a582c91a9e.mjs';

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

export { toolRegistry };
//# sourceMappingURL=57ea4bf5-1917-4e26-85fc-a6f7f033fd6b.mjs.map
