import { Tool } from '@mastra/core';
import { McpClient } from './remote/mcp.service';
import logger from '../utils/logger';
import { mcpServers } from './remote/mcp.config';
import { z } from 'zod';
import { McpRegistry } from './remote/index';
import { localTools } from './local/index';

class ToolRegistry {
  private mcpRegistry: McpRegistry;
  private localTools: Record<string, Tool<z.ZodType>> = {};
  private localToolNames: string[] = [];

  constructor(tools: any[] = []) {
    this.mcpRegistry = new McpRegistry(mcpServers);
    this.registerLocalTools(tools);
  }

  private registerLocalTools(tools: any[]) {
    tools.forEach((tool) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolId = (tool as any).id;
      if (this.localTools[toolId]) {
        logger.warn(
          `Local tool with ID '${toolId}' is already registered. It will be overwritten.`,
        );
      }
      this.localTools[toolId] = tool;
    });
    this.localToolNames = Object.keys(this.localTools);
  }

  public async initializeTools() {
    try {
      // Automatically initialize all MCP servers
      await this.mcpRegistry.initialize();

      // Log comprehensive tool registry for LLM
      // const toolsByServer = this.getToolsByServerMap();
      const totalTools = this.getToolNames().length;
      // logCompleteToolRegistryForLLM(toolsByServer, totalTools);

      logger.info(
        `Tool Registry initialized with ${totalTools} tools from ${this.getServerNames().join(
          ', ',
        )}`,
      );
    } catch (error) {
      logger.error('Failed to initialize Tool Registry:', error);
      throw error;
    }
  }

  /**
   * Get all registered tools as a flattened object with prefixed names
   */
  getTools(): Record<string, Tool<z.ZodType>> {
    const remoteTools = this.mcpRegistry.getTools();
    for (const name of this.localToolNames) {
      if (remoteTools[name]) {
        logger.warn(
          `Local tool '${name}' is hiding a remote tool with the same name.`,
        );
      }
    }
    return { ...remoteTools, ...this.localTools };
  }

  /**
   * Get tools grouped by MCP server name
   */
  getToolsByServerMap(): Record<string, Record<string, Tool<z.ZodType>>> {
    const serverMap = this.mcpRegistry.getToolsByServerMap();
    if (this.localToolNames.length > 0) {
      serverMap.local = this.localTools;
    }
    return serverMap;
  }

  /**
   * Get tools from a specific MCP server
   */
  getServerTools(serverName: string): Record<string, Tool<z.ZodType>> {
    if (serverName === 'local') {
      return this.localTools;
    }
    return this.mcpRegistry.getServerTools(serverName);
  }

  /**
   * Get tool names from a specific MCP server
   */
  getServerToolNames(serverName: string): string[] {
    if (serverName === 'local') {
      return this.localToolNames;
    }
    return this.mcpRegistry.getServerToolNames(serverName);
  }

  /**
   * Get available MCP server names
   */
  getServerNames(): string[] {
    const serverNames = this.mcpRegistry.getServerNames();
    if (this.localToolNames.length > 0) {
      return [...serverNames, 'local'];
    }
    return serverNames;
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): Tool<z.ZodType> | undefined {
    return this.localTools[name] || this.mcpRegistry.getTool(name);
  }

  /**
   * Get a specific tool from a specific server
   */
  getServerTool(
    serverName: string,
    toolName: string,
  ): Tool<z.ZodType> | undefined {
    if (serverName === 'local') {
      return this.localTools[toolName];
    }
    return this.mcpRegistry.getServerTool(serverName, toolName);
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return (
      this.localTools.hasOwnProperty(name) || this.mcpRegistry.hasTool(name)
    );
  }

  /**
   * Check if a server has a specific tool
   */
  hasServerTool(serverName: string, toolName: string): boolean {
    if (serverName === 'local') {
      return this.localTools.hasOwnProperty(toolName);
    }
    return this.mcpRegistry.hasServerTool(serverName, toolName);
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Object.keys(this.getTools());
  }

  /**
   * Get MCP server status
   */
  getStatus(): Record<string, { connected: boolean; toolCount: number }> {
    const status = this.mcpRegistry.getStatus();
    if (this.localToolNames.length > 0) {
      status.local = {
        connected: true,
        toolCount: this.localToolNames.length,
      };
    }
    return status;
  }

  /**
   * Set access token for all MCP clients that require authentication
   */
  setAccessTokenForAll(accessToken: string | null): void {
    this.mcpRegistry.setAccessTokenForAll(accessToken);
  }

  /**
   * Set access token for a specific MCP server
   */
  setAccessTokenForServer(
    serverName: string,
    accessToken: string | null,
  ): void {
    this.mcpRegistry.setAccessTokenForServer(serverName, accessToken);
  }

  /**
   * Get MCP client for a specific server (for direct access if needed)
   */
  getClient(serverName: string): McpClient | undefined {
    return this.mcpRegistry.getClient(serverName);
  }
}

// Create and initialize the instance, then export it.
const toolRegistryInstance = new ToolRegistry(localTools);
await toolRegistryInstance.initializeTools();
export const toolRegistry = toolRegistryInstance;
