import { McpServerConfig } from './mcp.dto';

export const mcpServers: McpServerConfig[] = [
  {
    name: 'restaurant-booking',
    url: process.env.RESTAURANT_BOOKING_MCP_URL || 'http://localhost:3001/mcp',
    healthUrl:
      process.env.RESTAURANT_BOOKING_MCP_HEALTH_URL ||
      'http://localhost:3001/health',
    enabled: process.env.RESTAURANT_BOOKING_MCP_ENABLED !== 'false',
  },
  {
    name: 'time',
    url: process.env.TIME_MCP_URL || 'http://localhost:3002/mcp',
    healthUrl:
      process.env.TIME_MCP_HEALTH_URL || 'http://localhost:3002/health',
    enabled: process.env.TIME_MCP_ENABLED !== 'false',
  },
  {
    name: 'google-assistant',
    url: process.env.GOOGLE_ASSISTANT_MCP_URL || 'http://localhost:3003/mcp',
    healthUrl:
      process.env.GOOGLE_ASSISTANT_MCP_HEALTH_URL ||
      'http://localhost:3003/health',
    enabled: process.env.GOOGLE_ASSISTANT_MCP_ENABLED !== 'false',
    requiresAuth: 'google',
  },
  {
    name: 'web-search',
    url: process.env.WEB_SEARCH_MCP_URL || 'http://localhost:3004/mcp',
    healthUrl:
      process.env.WEB_SEARCH_MCP_HEALTH_URL || 'http://localhost:3004/health',
    enabled: process.env.WEB_SEARCH_MCP_ENABLED !== 'false',
  },
  {
    name: 'atlassian',
    url: process.env.ALTASIAN_MCP_URL || 'http://localhost:3005/mcp',
    healthUrl:
      process.env.ALTASIAN_MCP_HEALTH_URL || 'http://localhost:3005/health',
    enabled: process.env.ALTASIAN_MCP_ENABLED !== 'false',
  },
  {
    name: 'reddit',
    url: process.env.REDDIT_MCP_URL || 'http://localhost:3006/mcp',
    healthUrl:
      process.env.REDDIT_MCP_HEALTH_URL || 'http://localhost:3006/health',
    enabled: process.env.REDDIT_MCP_ENABLED !== 'false',
  },
  {
    name: 'perplexity',
    url: process.env.PERPLEXITY_MCP_URL || 'http://localhost:3007/mcp',
    healthUrl:
      process.env.PERPLEXITY_MCP_HEALTH_URL || 'http://localhost:3007/health',
    enabled: process.env.PERPLEXITY_MCP_ENABLED !== 'false',
  },
];
