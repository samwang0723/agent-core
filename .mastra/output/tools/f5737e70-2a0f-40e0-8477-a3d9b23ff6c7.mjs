import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { l as logger } from '../logger.mjs';
import 'winston';

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

export { McpClient };
//# sourceMappingURL=f5737e70-2a0f-40e0-8477-a3d9b23ff6c7.mjs.map
