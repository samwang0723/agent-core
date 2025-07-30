/**
 * Feature flags for controlling rollout of new features
 */

export class FeatureFlags {
  private static instance: FeatureFlags;

  private constructor() {}

  public static getInstance(): FeatureFlags {
    if (!FeatureFlags.instance) {
      FeatureFlags.instance = new FeatureFlags();
    }
    return FeatureFlags.instance;
  }

  /**
   * Check if unified notifications are enabled
   */
  public isUnifiedNotificationsEnabled(): boolean {
    return process.env.ENABLE_UNIFIED_NOTIFICATIONS === 'true';
  }

  /**
   * Check if unified notifications are enabled for a specific user
   * This allows for gradual rollout to specific users
   */
  public isUnifiedNotificationsEnabledForUser(userId: string): boolean {
    // If globally disabled, return false
    if (!this.isUnifiedNotificationsEnabled()) {
      return false;
    }

    // Check if specific users are whitelisted
    const whitelistedUsers = process.env.UNIFIED_NOTIFICATIONS_WHITELIST;
    if (whitelistedUsers) {
      const userList = whitelistedUsers.split(',').map(u => u.trim());
      return userList.includes(userId);
    }

    // If no whitelist, enable for all users when global flag is on
    return true;
  }

  /**
   * Check if login summaries are enabled
   */
  public isLoginSummaryEnabled(): boolean {
    return process.env.ENABLE_LOGIN_SUMMARY !== 'false'; // Default to true
  }

  /**
   * Check if periodic unified summaries are enabled
   */
  public isPeriodicSummaryEnabled(): boolean {
    return process.env.ENABLE_PERIODIC_SUMMARY !== 'false'; // Default to true
  }

  /**
   * Check if real-time event broadcasting is enabled
   */
  public isRealTimeEventsEnabled(): boolean {
    return process.env.ENABLE_REAL_TIME_EVENTS !== 'false'; // Default to true
  }
}

// Export singleton instance
export const featureFlags = FeatureFlags.getInstance();
