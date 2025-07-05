import winston from 'winston';

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      const args = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
      return `${timestamp} ${level}: ${message} ${args}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          let args = "";
          if (typeof message === "object") {
            args = JSON.stringify(message, null, 2);
            message = "";
          }
          const extraArgs = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
          return `${timestamp} ${level}: ${message} ${args} ${extraArgs}`.trim();
        })
      )
    }),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" })
  ]
});
const logger = {
  info: (message, ...args) => winstonLogger.info(message, ...args),
  warn: (message, ...args) => winstonLogger.warn(message, ...args),
  error: (message, ...args) => {
    if (message instanceof Error) {
      winstonLogger.error(message.message, message, ...args);
    } else {
      winstonLogger.error(message, ...args);
    }
  },
  debug: (message, ...args) => winstonLogger.debug(message, ...args),
  getTransports: () => {
    return /* @__PURE__ */ new Map();
  },
  trackException: (error) => {
    const err = error.originalError || new Error(error.message);
    winstonLogger.error(err.message, {
      stack: err.stack,
      properties: error.properties,
      measurements: error.measurements
    });
  },
  getLogs: async (transportId, params) => {
    console.log(
      `Getting logs for transport: ${transportId} with params:`,
      params
    );
    return {
      logs: [],
      total: 0,
      page: params?.page || 1,
      perPage: params?.perPage || 10,
      hasMore: false
    };
  },
  getLogsByRunId: async (args) => {
    console.log(`Getting logs for runId: ${args.runId} with params:`, args);
    return {
      logs: [],
      total: 0,
      page: args.page || 1,
      perPage: args.perPage || 10,
      hasMore: false
    };
  }
};

export { logger as l };
//# sourceMappingURL=logger.mjs.map
