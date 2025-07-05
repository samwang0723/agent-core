import { registerApiRoute } from '@mastra/core/server';
import { googleAuth } from '@hono/oauth-providers/google';

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
    {
      handler: googleAuthMiddleware,
      path: "/api/*"
      // Protect all /api endpoints
    },
    // Add a global request logger
    async (c, next) => {
      console.log(`${c.req.method} ${c.req.url}`);
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
  })]
};

export { server };
//# sourceMappingURL=server-config.mjs.map
