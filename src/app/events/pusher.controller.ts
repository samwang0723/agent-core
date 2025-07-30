import { Hono, Context } from 'hono';
import { pusherEventBroadcaster } from './pusher.service';
import { eventSubscriptionManager } from './subscription.manager';
import { EventType } from './event.types';
import { requireAuth, Session } from '../middleware/auth';
import logger from '../utils/logger';

interface AuthContext extends Context {
  get(key: 'user'): Session;
}

const app = new Hono();

// Get Pusher configuration for frontend
app.get('/config', requireAuth, async c => {
  try {
    const config = pusherEventBroadcaster.getChannelInfo();

    return c.json({
      key: config.key,
      cluster: config.cluster,
      // Don't expose the secret or app ID to frontend
    });
  } catch (error) {
    logger.error('Failed to get Pusher config', { error });
    return c.json({ error: 'Failed to get configuration' }, 500);
  }
});

// Pusher authentication endpoint for private channels
app.post('/auth', requireAuth, async (c: AuthContext) => {
  const userId = c.get('user').id;

  try {
    const { socket_id, channel_name } = await c.req.json();

    if (!socket_id || !channel_name) {
      return c.json({ error: 'Missing socket_id or channel_name' }, 400);
    }

    // Validate that user is accessing their own channel
    const expectedChannel = `user-${userId}`;
    if (channel_name !== expectedChannel) {
      logger.warn(
        `User ${userId} attempted to access unauthorized channel ${channel_name}`
      );
      return c.json({ error: 'Unauthorized channel access' }, 403);
    }

    const auth = await pusherEventBroadcaster.authenticateUser(
      socket_id,
      channel_name,
      userId
    );

    return c.json({ auth });
  } catch (error) {
    logger.error(`Failed to authenticate Pusher channel for user ${userId}`, {
      error,
    });
    return c.json({ error: 'Authentication failed' }, 401);
  }
});

// Get user's event subscription preferences
app.get('/subscription', requireAuth, async (c: AuthContext) => {
  const userId = c.get('user').id;

  try {
    const subscription = await eventSubscriptionManager.getSubscription(userId);

    if (!subscription) {
      // Create default subscription if none exists
      const defaultSubscription =
        await eventSubscriptionManager.initializeDefaultSubscription(userId);
      return c.json(defaultSubscription);
    }

    return c.json(subscription);
  } catch (error) {
    logger.error(`Failed to get subscription for user ${userId}`, { error });
    return c.json({ error: 'Failed to get subscription' }, 500);
  }
});

// Update user's event subscription preferences
app.put('/subscription', requireAuth, async (c: AuthContext) => {
  const userId = c.get('user').id;

  try {
    const { eventTypes, isActive } = await c.req.json();

    // Validate event types
    const validEventTypes = eventTypes.filter((type: string) =>
      Object.values(EventType).includes(type as EventType)
    );

    const subscription =
      await eventSubscriptionManager.createOrUpdateSubscription(
        userId,
        validEventTypes,
        isActive
      );

    return c.json(subscription);
  } catch (error) {
    logger.error(`Failed to update subscription for user ${userId}`, { error });
    return c.json({ error: 'Failed to update subscription' }, 500);
  }
});

// Get user's channel name for Pusher subscription
app.get('/channel', requireAuth, async (c: AuthContext) => {
  const userId = c.get('user').id;

  try {
    // Initialize user's default subscription if they don't have one
    await eventSubscriptionManager.initializeDefaultSubscription(userId);

    return c.json({
      channel: `user-${userId}`,
      userId,
    });
  } catch (error) {
    logger.error(`Failed to get channel for user ${userId}`, { error });
    return c.json({ error: 'Failed to get channel information' }, 500);
  }
});

// Send system notification to all users
app.post('/broadcast', requireAuth, async c => {
  // Only allow certain users to broadcast (could add role check here)
  try {
    const { message, userIds } = await c.req.json();

    if (!message) {
      return c.json({ error: 'Message is required' }, 400);
    }

    await pusherEventBroadcaster.broadcastSystemNotification(message, userIds);

    return c.json({
      message: 'Notification broadcasted',
      recipients: userIds ? userIds.length : 'all users',
    });
  } catch (error) {
    logger.error('Failed to broadcast system notification', { error });
    return c.json({ error: 'Failed to broadcast notification' }, 500);
  }
});

export default app;
