/**
 * Logger utility that conditionally outputs to console based on environment.
 * In production, only errors are logged. In development, all levels are enabled.
 *
 * Usage:
 *   import { logger } from "src/utils/logger";
 *   logger.log("Debug info");      // Only in dev
 *   logger.warn("Warning");        // Only in dev
 *   logger.error("Error", err);    // Always logged
 *   logger.debug("Verbose");       // Only in dev
 */

const isDev = import.meta.env.DEV;

type LogArgs = unknown[];

export const logger = {
  /**
   * General logging - only outputs in development
   */
  log: (...args: LogArgs): void => {
    if (isDev) {
      console.log(...args);
    }
  },

  /**
   * Warning logging - only outputs in development
   */
  warn: (...args: LogArgs): void => {
    if (isDev) {
      console.warn(...args);
    }
  },

  /**
   * Error logging - always outputs (errors should be visible in production)
   */
  error: (...args: LogArgs): void => {
    console.error(...args);
  },

  /**
   * Debug logging - only outputs in development
   * Use for verbose/detailed debugging output
   */
  debug: (...args: LogArgs): void => {
    if (isDev) {
      console.debug(...args);
    }
  },

  /**
   * Group logging - only outputs in development
   */
  group: (label: string): void => {
    if (isDev) {
      console.group(label);
    }
  },

  /**
   * Group end - only outputs in development
   */
  groupEnd: (): void => {
    if (isDev) {
      console.groupEnd();
    }
  },

  /**
   * Table logging - only outputs in development
   */
  table: (data: unknown): void => {
    if (isDev) {
      console.table(data);
    }
  },

  /**
   * Time tracking - only outputs in development
   */
  time: (label: string): void => {
    if (isDev) {
      console.time(label);
    }
  },

  /**
   * Time end - only outputs in development
   */
  timeEnd: (label: string): void => {
    if (isDev) {
      console.timeEnd(label);
    }
  },
};

export default logger;
