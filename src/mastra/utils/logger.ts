import { IMastraLogger, LoggerTransport, LogLevel } from '@mastra/core/logger';
import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      const args = Object.keys(rest).length
        ? JSON.stringify(rest, null, 2)
        : '';
      return `${timestamp} ${level}: ${message} ${args}`;
    }),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          let args = '';
          if (typeof message === 'object') {
            args = JSON.stringify(message, null, 2);
            message = '';
          }
          const extraArgs = Object.keys(rest).length
            ? JSON.stringify(rest, null, 2)
            : '';
          return `${timestamp} ${level}: ${message} ${args} ${extraArgs}`.trim();
        }),
      ),
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

const logger: IMastraLogger = {
  info: (message: string, ...args: any[]) =>
    winstonLogger.info(message, ...args),
  warn: (message: string, ...args: any[]) =>
    winstonLogger.warn(message, ...args),
  error: (message: string | Error, ...args: any[]) => {
    if (message instanceof Error) {
      winstonLogger.error(message.message, message, ...args);
    } else {
      winstonLogger.error(message, ...args);
    }
  },
  debug: (message: string, ...args: any[]) =>
    winstonLogger.debug(message, ...args),
  getTransports: (): Map<string, LoggerTransport> => {
    return new Map<string, LoggerTransport>();
  },
  trackException: (error: {
    originalError?: Error;
    message: string;
    properties?: { [key: string]: any };
    measurements?: { [key: string]: number };
  }) => {
    const err = error.originalError || new Error(error.message);
    winstonLogger.error(err.message, {
      stack: err.stack,
      properties: error.properties,
      measurements: error.measurements,
    });
  },
  getLogs: async (
    transportId: string,
    params?: {
      fromDate?: Date;
      toDate?: Date;
      logLevel?: LogLevel;
      filters?: Record<string, any>;
      page?: number;
      perPage?: number;
    },
  ): Promise<{
    logs: any[];
    total: number;
    page: number;
    perPage: number;
    hasMore: boolean;
  }> => {
    console.log(
      `Getting logs for transport: ${transportId} with params:`,
      params,
    );
    return {
      logs: [],
      total: 0,
      page: params?.page || 1,
      perPage: params?.perPage || 10,
      hasMore: false,
    };
  },
  getLogsByRunId: async (args: {
    transportId: string;
    runId: string;
    fromDate?: Date;
    toDate?: Date;
    logLevel?: LogLevel;
    filters?: Record<string, any>;
    page?: number;
    perPage?: number;
  }): Promise<{
    logs: any[];
    total: number;
    page: number;
    perPage: number;
    hasMore: boolean;
  }> => {
    console.log(`Getting logs for runId: ${args.runId} with params:`, args);
    return {
      logs: [],
      total: 0,
      page: args.page || 1,
      perPage: args.perPage || 10,
      hasMore: false,
    };
  },
};

export default logger;
