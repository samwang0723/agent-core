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

export { mcpServers };
//# sourceMappingURL=92bc2908-9d94-49ad-a4c4-06102fe95d05.mjs.map
