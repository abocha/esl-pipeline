import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Update } from '@grammyjs/types';

import type { AuditLogger, BotConfig } from './types.js';

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
  }
}

export interface RunningWebhookUpdateServer {
  port: number;
  path: string;
  close: () => Promise<void>;
}

function readWebhookSecretTokenHeader(req: IncomingMessage): string | undefined {
  const value = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    req.on('data', (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > MAX_WEBHOOK_BODY_BYTES) {
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startWebhookUpdateServer(args: {
  config: BotConfig;
  audit: AuditLogger;
  onUpdate: (update: Update) => Promise<void>;
}): Promise<RunningWebhookUpdateServer> {
  const webhookPath = args.config.webhookPath;
  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method !== 'POST' || requestUrl.pathname !== webhookPath) {
      sendJson(res, 404, {
        ok: false,
        error: 'not_found',
      });
      return;
    }

    const expectedToken = args.config.webhookSecretToken;
    if (expectedToken) {
      const providedToken = readWebhookSecretTokenHeader(req);
      if (providedToken !== expectedToken) {
        sendJson(res, 403, {
          ok: false,
          error: 'forbidden',
          message: 'Invalid x-telegram-bot-api-secret-token',
        });
        return;
      }
    }

    let parsed: unknown;
    try {
      const rawBody = await readBody(req);
      parsed = JSON.parse(rawBody);
    } catch (error: unknown) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(res, 413, {
          ok: false,
          error: 'payload_too_large',
        });
        return;
      }
      sendJson(res, 400, {
        ok: false,
        error: 'invalid_json',
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      sendJson(res, 400, {
        ok: false,
        error: 'invalid_payload',
      });
      return;
    }

    try {
      await args.onUpdate(parsed as Update);
      sendJson(res, 200, {
        ok: true,
      });
    } catch (error: unknown) {
      args.audit.log({
        level: 'error',
        event: 'webhook_update_failed',
        message: 'Failed processing webhook update',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      sendJson(res, 500, {
        ok: false,
        error: 'internal_error',
      });
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(args.config.webhookPort, args.config.webhookHost);
    });
  } catch (error: unknown) {
    args.audit.log({
      level: 'error',
      event: 'webhook_listener_start_failed',
      message: 'Failed to bind webhook listener',
      details: {
        host: args.config.webhookHost,
        port: args.config.webhookPort,
        path: webhookPath,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? args.config.webhookPort;
  args.audit.log({
    level: 'info',
    event: 'webhook_listener_started',
    message: 'Webhook listener started',
    chatId: args.config.chatId,
    details: {
      host: args.config.webhookHost,
      port,
      path: webhookPath,
    },
  });

  let closed = false;
  return {
    port,
    path: webhookPath,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await closeServer(server);
        args.audit.log({
          level: 'info',
          event: 'webhook_listener_stopped',
          message: 'Webhook listener stopped',
          chatId: args.config.chatId,
          details: {
            host: args.config.webhookHost,
            port,
            path: webhookPath,
          },
        });
      } catch (error: unknown) {
        args.audit.log({
          level: 'warn',
          event: 'webhook_listener_stop_failed',
          message: 'Webhook listener close failed',
          chatId: args.config.chatId,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  };
}
