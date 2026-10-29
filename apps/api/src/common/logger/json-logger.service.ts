import { LoggerService, Injectable } from '@nestjs/common';

/**
 * Minimal structured logger: one JSON object per line.
 * Callers must never pass passwords, tokens or full transaction descriptions
 * unless they are needed for diagnosis.
 */
@Injectable()
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string, stack?: string): void {
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : String(message),
    };
    if (context) entry.context = context;
    if (stack) entry.stack = stack;
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }
}
