import { googleAuth } from "@hono/oauth-providers/google";

export const googleAuthMiddleware = googleAuth({
  client_id: process.env.GOOGLE_CLIENT_ID!,
  client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  scope: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar",
  ],
  redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
  access_type: "offline",
  prompt: "consent",
  state: "agent-auth", // CSRF protection
});
