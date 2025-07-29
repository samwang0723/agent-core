import { createTool, Tool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import logger from '../../utils/logger';
import {
  McpServerConfig,
  McpTool,
  JsonRpcResponse,
  ToolsListResult,
  ToolCallResult,
} from './mcp.dto';
import { JsonSchema } from './mcp.dto';
import { UserRuntimeContext } from '../../utils/context';
import { RuntimeContext } from '@mastra/core/di';

// Utility function to mask sensitive data in headers
function maskSensitiveHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const sensitiveKeys = ['authorization', 'cookie', 'x-api-key', 'api-key'];
  const masked = { ...headers };

  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveKeys.includes(key.toLowerCase()) && value) {
      // Mask the token but show first/last few characters for debugging
      if (value.length > 10) {
        masked[key] =
          `${value.substring(0, 6)}...${value.substring(value.length - 4)}`;
      } else {
        masked[key] = '***[MASKED]***';
      }
    }
  }

  return masked;
}

export class McpClient {
  private sessionId: string | null = null;
  private availableTools: McpTool[] = [];
  constructor(private config: McpServerConfig) {}

  async initialize(): Promise<void> {
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

  private async healthCheck(): Promise<void> {
    if (!this.config.healthUrl) return;

    const response = await fetch(this.config.healthUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  }

  private async initializeSession(): Promise<void> {
    const initTimeout = parseInt(process.env.MCP_INIT_TIMEOUT || '5000');

    try {
      // Match the exact format from the working test script
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'init',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'agent-swarm', version: '1.0.0' },
          },
        }),
        signal: AbortSignal.timeout(initTimeout),
      });
      logger.info(`Session initialization request: ${this.config.url}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Session initialization failed: ${response.status} - ${errorText}`
        );
      }

      // Get the full response text to extract session ID (like curl -i)
      const responseText = await response.text();

      // Extract session ID from headers (check both response headers and response text)
      this.sessionId = response.headers.get('mcp-session-id');
      if (!this.sessionId) {
        // Try to extract from response text if it's in there
        const sessionMatch = responseText.match(
          /mcp-session-id:\s*([^\s\r\n]+)/
        );
        this.sessionId = sessionMatch ? sessionMatch[1].trim() : 'default';
      }

      logger.info(`MCP session initialized: ${this.sessionId}`);

      // Send initialized notification (skip response handling for notification)
      try {
        await fetch(this.config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'mcp-session-id': this.sessionId,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {},
          }),
          signal: AbortSignal.timeout(initTimeout),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          logger.warn(
            `Initialized notification timed out after ${initTimeout}ms:`,
            error
          );
        } else {
          logger.warn('Failed to send initialized notification:', error);
        }
        // Don't fail the whole initialization for this
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        const errorMessage = `MCP session initialization timed out after ${initTimeout}ms for ${this.config.name}`;
        logger.error(errorMessage, error);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  private async loadTools(): Promise<void> {
    const initTimeout = parseInt(process.env.MCP_INIT_TIMEOUT || '5000');

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': this.sessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 'list-tools',
        }),
        signal: AbortSignal.timeout(initTimeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to list tools: ${response.status} - ${errorText}`
        );
      }

      // Handle both JSON and SSE responses
      const responseText = await response.text();
      const result = this.parseResponse(responseText);

      if (result.error) {
        throw new Error(`Tools list error: ${result.error.message}`);
      }

      this.availableTools = (result.result as ToolsListResult)?.tools || [];

      logger.info(
        `Loaded ${this.availableTools.length} tools from ${this.config.name}:`,
        this.availableTools.map(t => t.name)
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        const errorMessage = `MCP tools loading timed out after ${initTimeout}ms for ${this.config.name}`;
        logger.error(errorMessage, error);
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  async callTool(
    name: string,
    parameters: Record<string, unknown> | ToolExecutionContext<z.ZodType>,
    authToken?: string
  ): Promise<unknown> {
    if (!this.sessionId) {
      throw new Error('MCP session not initialized');
    }

    const googleAuthToken = (
      parameters.runtimeContext as RuntimeContext<UserRuntimeContext>
    )?.get('googleAuthToken');

    // Check if authentication is required
    const needsAuth =
      this.config.requiresAuth ||
      this.availableTools.find(t => t.name === name)?.requiresAuth;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': this.sessionId,
    };

    // Add authorization header if needed
    if (needsAuth) {
      logger.debug(
        `[${name}] Tool: needsAuth: ${needsAuth}, googleAuthToken: ${googleAuthToken}, authToken: ${authToken}`
      );
      const accessToken = authToken || googleAuthToken;
      if (needsAuth === 'google' && accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        logger.debug(
          `[${name}] Tool: Authorization header: ${headers['Authorization']}`
        );
      } else {
        throw new Error(
          `Tool '${name}' requires authentication but no access token provided`
        );
      }
    }

    // Handle both raw parameters and ToolExecutionContext
    const toolParameters =
      'context' in parameters ? parameters.context : parameters;

    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: toolParameters },
      id: Date.now(),
    };

    try {
      const startTime = Date.now();
      logger.info(
        `Calling tool ${name} with parameters: ${JSON.stringify(payload)}, headers: ${JSON.stringify(maskSensitiveHeaders(headers))}`
      );
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(
          parseInt(process.env.MCP_TIMEOUT || '30000')
        ),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Tool call failed: ${response.status} ${response.statusText} - ${errorText}`;

        throw new Error(errorMessage);
      }

      // Handle both JSON and SSE responses
      const responseText = await response.text();

      const result = this.parseResponse(responseText);
      const endTime = Date.now();
      const duration = endTime - startTime;
      logger.info(`Tool call result responded in ${duration}ms`);

      if (result.error) {
        const errorMessage = `Tool execution error: ${result.error.message}`;
        throw new Error(errorMessage);
      }

      // Handle MCP response format
      const toolCallResult = result.result as ToolCallResult;
      if (toolCallResult?.content?.[0]?.type === 'text') {
        const text = toolCallResult.content[0].text;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return result.result;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        const timeout = parseInt(process.env.MCP_TIMEOUT || '30000') / 1000;
        const errorMessage = `The tool call to '${name}' timed out after ${timeout} seconds. Please try again later.`;

        logger.error(errorMessage);
        return {
          error: errorMessage,
        };
      }

      throw error;
    }
  }

  getAvailableTools(): Tool<z.ZodType>[] {
    return this.availableTools.map(mcpTool => {
      const zodSchema = this.convertInputSchemaToZod(mcpTool.inputSchema);

      return createTool({
        id: mcpTool.name,
        description: mcpTool.description,
        inputSchema: zodSchema,
        execute: async parameters => {
          return await this.callTool(
            mcpTool.name,
            parameters,
            mcpTool.requiresAuth
          );
        },
      });
    });
  }

  private convertInputSchemaToZod(schema: JsonSchema): z.ZodType {
    if (!schema || !schema.type) {
      // Return a default schema if the input is invalid
      return z.any();
    }

    switch (schema.type) {
      case 'object': {
        const shape: z.ZodRawShape = {};
        if (schema.properties) {
          for (const key of Object.keys(schema.properties)) {
            const prop = schema.properties[key];
            let zodType = this.convertInputSchemaToZod(prop).describe(
              prop.description || ''
            );

            if (!schema.required?.includes(key)) {
              zodType = zodType.optional();
            }
            shape[key] = zodType;
          }
        }
        return z.object(shape);
      }
      case 'string':
        return z.string().describe(schema.description || '');
      case 'number':
      case 'integer':
        return z.number().describe(schema.description || '');
      case 'boolean':
        return z.boolean().describe(schema.description || '');
      case 'array':
        if (schema.items) {
          return z
            .array(this.convertInputSchemaToZod(schema.items))
            .describe(schema.description || '');
        }
        return z.array(z.any()).describe(schema.description || ''); // Fallback for arrays with no item schema
      default:
        return z.any(); // Fallback for unknown types
    }
  }

  getToolNames(): string[] {
    return this.availableTools.map(t => t.name);
  }

  private parseResponse(responseText: string): JsonRpcResponse {
    try {
      // Handle JSON-RPC response
      if (responseText.trim().startsWith('{')) {
        return JSON.parse(responseText);
      }

      // Handle Server-Sent Events (SSE) stream
      const lines = responseText
        .trim()
        .split('\n')
        .filter(line => line.startsWith('data: '));

      if (lines.length > 0) {
        // In case of multiple data lines, we might need to decide how to handle them.
        // For now, parsing the last one as it's most likely the final result.
        const lastLine = lines[lines.length - 1];
        const jsonData = lastLine.substring(5).trim();
        return JSON.parse(jsonData);
      }

      // Fallback for unexpected format
      throw new Error('Invalid response format');
    } catch (error) {
      logger.error('Failed to parse MCP response:', {
        responseText,
        error,
      });
      // Ensure a consistent error format
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700, // Parse error
          message: 'Failed to parse response',
          data: responseText,
        },
      };
    }
  }
}
