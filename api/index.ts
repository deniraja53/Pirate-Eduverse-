/**
 * Vercel Serverless Function Entry Point for Pirate Academy 3D (/api/*)
 * Handles all /api/* routes (teacher auth-status, login, setup-pin, active quiz,
 * sessions, importers, and Google Sheets sync) without calling app.listen().
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server/apiApp.ts';

const apiApp = createApiApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url || '/api';
  if (rawUrl.startsWith('/api/index') || rawUrl === '/api' || rawUrl.startsWith('/api?')) {
    const parsed = new URL(rawUrl, 'http://localhost');
    const rewrittenPath = (parsed.searchParams.get('__path') || '').replace(/^\/+/, '');
    if (rewrittenPath || parsed.searchParams.has('__path')) {
      parsed.searchParams.delete('__path');
      const remainingQuery = parsed.searchParams.toString();
      req.url = `/api${rewrittenPath ? `/${rewrittenPath}` : ''}${
        remainingQuery ? `?${remainingQuery}` : ''
      }`;
    }
  }
  return apiApp(req as Parameters<typeof apiApp>[0], res as Parameters<typeof apiApp>[1]);
}
