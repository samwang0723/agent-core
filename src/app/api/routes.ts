import { Hono } from 'hono';
import { authRouter } from '../users/user.controller';
import { healthRouter } from '../health/health.controller';
import { chatRouter } from '../conversations/conversation.controller';

const apiRouter = new Hono();

// Mount routes
apiRouter.route('/auth', authRouter);
apiRouter.route('/health', healthRouter);
apiRouter.route('/chat', chatRouter);

export { apiRouter };
