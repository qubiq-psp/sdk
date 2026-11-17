// Example plumbing at the Express level, before the Nest routes: the call id of passthrough routes, the body parsers
// (raw bytes for the webhook receiver, JSON for /api) and the static UI.
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { AppConfig } from '../config/app-config';
import { WEBHOOK_PATH } from '../webhooks/webhook-receiver.controller';
import { ExampleError } from './example-error';
import { assignCallId } from './passthrough';

/** The receiver reads at most 1 MB; a webhook body is a few KB. */
const BODY_LIMIT = '1mb';

export function configureHttp(app: NestExpressApplication, config: AppConfig): void {
  app.disable('x-powered-by');
  // Passthrough answers keep the platform's status: no ETag, so never a 304 of this backend's own
  app.set('etag', false);
  // nginx on the same host is the only client: req.ip is then the address nginx saw
  app.set('trust proxy', 'loopback');

  app.use(assignCallId);
  // The webhook signature covers the raw bytes: this path gets them untouched as a Buffer, whatever the Content-Type
  app.use(WEBHOOK_PATH, refuseUnreadable(express.raw({ type: () => true, limit: BODY_LIMIT })));
  // Any body of an /api request is JSON. strict: false — a passthrough body is forwarded as parsed, the platform
  // judges it (a bare `5` is valid JSON). Without a body req.body stays undefined: nothing is sent on.
  const json = express.json({
    type: () => true,
    strict: false,
    limit: BODY_LIMIT,
    verify: (req: Request & { hadBody?: boolean }, _res, buf) => {
      req.hadBody = buf.length > 0;
    },
  });
  app.use(
    '/api',
    refuseUnreadable(json),
    (req: Request & { hadBody?: boolean }, _res: Response, next: NextFunction) => {
      // body-parser turns an empty body (`Content-Length: 0`) into {}: that is no body
      if (req.hadBody !== true) req.body = undefined;
      next();
    },
  );

  if (config.uiDir !== null) serveUi(app, config.uiDir);
}

/** A body that cannot be read (not JSON, too large) is `400 example_invalid_request`, before any platform call. */
function refuseUnreadable(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void parser(req, res, (err?: unknown) => {
      if (err === undefined || err === null) {
        next();
        return;
      }
      const tooLarge = (err as { type?: unknown }).type === 'entity.too.large';
      const error = ExampleError.invalid('body', tooLarge ? `is larger than ${BODY_LIMIT}` : 'is not valid JSON');
      res.status(error.status).json(error.toBody());
    });
  };
}

/** The built UI with an SPA fallback: a GET outside /api and /webhooks that is not a file gets index.html. */
function serveUi(app: NestExpressApplication, uiDir: string): void {
  const isBackend = (path: string): boolean => /^\/(api|webhooks)(\/|$)/.test(path);
  const files = express.static(uiDir, { index: 'index.html' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isBackend(req.path)) {
      next();
      return;
    }
    void files(req, res, next);
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isBackend(req.path)) {
      next();
      return;
    }
    res.sendFile('index.html', { root: uiDir });
  });
}
