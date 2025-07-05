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
    {
      handler: async (c, next) => {
        const authHeader = c.req.header("Authorization");
        if (!authHeader) {
          return new Response("Unauthorized", {
            status: 401
          });
        }
        await next();
      },
      path: "/api/*"
    },
    // Add a global request logger
    async (c, next) => {
      console.log(`${c.req.method} ${c.req.url}`);
      await next();
    }
  ]
};

export { server };
//# sourceMappingURL=server-config.mjs.map
