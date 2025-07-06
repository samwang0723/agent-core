import { Hono } from 'hono';
import { toolRegistry } from '../../mastra/tools/registry';

const app = new Hono();

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, error]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 mcp:
 *                   type: object
 *                   description: MCP status information
 *                 tools:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     names:
 *                       type: array
 *                       items:
 *                         type: string
 */
app.get('/', async c => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    mcp: toolRegistry.getStatus(),
    tools: {
      total: toolRegistry.getToolNames().length,
      names: toolRegistry.getToolNames(),
    },
  };

  return c.json(health);
});

export { app as healthRouter };
