import fs from 'fs';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');

async function writeLog(level: string, message: string) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const fileName = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
    const line = `[${new Date().toISOString()}] [pid:${process.pid}] [${level}] ${message}\n`;
    // Use sync I/O so short-lived worker tasks don't exit before logs are flushed.
    fs.appendFileSync(fileName, line, { encoding: 'utf8' });
  } catch (err) {
    // If logging fails, fallback to console so scheduled task still shows output
    // eslint-disable-next-line no-console
    console.error('Logger failed to write:', err);
  }
}

export const logger = {
  info: (msg: string) => writeLog('INFO', msg),
  warn: (msg: string) => writeLog('WARN', msg),
  error: (msg: string) => writeLog('ERROR', msg),
  debug: (msg: string) => writeLog('DEBUG', msg),
};

export default logger;
