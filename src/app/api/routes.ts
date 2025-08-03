import { Hono } from 'hono';
import { authRouter } from '../users/user.controller';
import { healthRouter } from '../health/health.controller';
import { chatRouter } from '../conversations/conversation.controller';
import { realtimeAudioRouter } from '../voices/voice.controller';
import pusherController from '../events/pusher.controller';

const apiRouter = new Hono();

// Mount routes
apiRouter.route('/auth', authRouter);
apiRouter.route('/health', healthRouter);
apiRouter.route('/chat', chatRouter);
apiRouter.route('/voice', realtimeAudioRouter);
apiRouter.route('/events', pusherController); // Pusher-based events (renamed from /pusher for consistency)

export { apiRouter };
