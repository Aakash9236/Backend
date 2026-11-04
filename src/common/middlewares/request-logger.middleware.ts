import morgan from 'morgan';
import { logger } from '../../config/logger.config';
import { env } from '../../config/env.config';

const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

const skip = () => {
  return env.NODE_ENV === 'test';
};

export const requestLogger = morgan(
  ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms',
  { stream, skip }
);

