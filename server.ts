/**
 * Unified Full-Stack Express + WebSocket + Vite Server for Pirate Academy 3D
 * Handles:
 * - Shared /api/* routes from server/apiApp.ts
 * - Real-time WebSocket updates on /ws
 * - /og-cover.jpg & Vite dev / production static serving on port 3000 (or PORT in production)
 * Created by Deni Raja99
 */

import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Request } from 'express';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './server/apiApp.ts';

const PORT =
  process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000;

let wssRef: WebSocketServer | null = null;

function broadcastWs(type: string, payload: unknown) {
  if (!wssRef) return;
  const message = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
  wssRef.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const app = createApiApp({ broadcastWs });
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wssRef = wss;

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      type: 'ws:connected',
      payload: { serverTime: new Date().toISOString() },
    })
  );
});

// ========================
// VITE / STATIC SERVING
// ========================

const DEFAULT_PUBLIC_ORIGIN =
  'https://ais-pre-kvauz3ffvwjgw4vguqkyfw-518887689182.asia-southeast1.run.app';

function resolvePublicOrigin(req: Request): string {
  const envUrl = (
    process.env.PUBLIC_APP_URL ||
    process.env.SHARED_APP_URL ||
    ''
  ).trim();
  if (envUrl.startsWith('https://')) {
    return envUrl.replace(/\/+$/, '');
  }

  const forwardedHostRaw = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(forwardedHostRaw)
    .split(',')[0]
    ?.trim()
    .toLowerCase()
    .replace(/:443$/, '') || '';
  const isValidPublicHost =
    /^[a-z0-9.-]+(:\d+)?$/.test(host) &&
    !host.startsWith('localhost') &&
    !host.startsWith('127.0.0.1') &&
    !host.startsWith('0.0.0.0') &&
    !host.startsWith('ais-dev-');

  if (isValidPublicHost) {
    return `https://${host}`;
  }

  const appUrl = (process.env.APP_URL || '').trim();
  if (appUrl.startsWith('https://') && !appUrl.includes('://ais-dev-')) {
    return appUrl.replace(/\/+$/, '');
  }

  return DEFAULT_PUBLIC_ORIGIN;
}

function injectPublicOriginIntoHtml(html: string, req: Request): string {
  const origin = resolvePublicOrigin(req);
  if (origin === DEFAULT_PUBLIC_ORIGIN) {
    return html;
  }
  return html.split(DEFAULT_PUBLIC_ORIGIN).join(origin);
}

async function startServer() {
  const publicOgCoverPath = path.resolve(process.cwd(), 'public', 'og-cover.jpg');
  const distOgCoverPath = path.resolve(process.cwd(), 'dist', 'og-cover.jpg');

  app.get('/og-cover.jpg', (_req, res, next) => {
    const filePath = fs.existsSync(distOgCoverPath)
      ? distOgCoverPath
      : fs.existsSync(publicOgCoverPath)
      ? publicOgCoverPath
      : null;
    if (!filePath) {
      next();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.get('/', async (req, res, next) => {
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        const rawHtml = fs.readFileSync(indexPath, 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res
          .status(200)
          .type('text/html; charset=utf-8')
          .send(injectPublicOriginIntoHtml(transformed, req));
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const distIndexPath = path.join(distDir, 'index.html');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      const rawHtml = fs.readFileSync(distIndexPath, 'utf-8');
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(injectPublicOriginIntoHtml(rawHtml, _req));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pirate Academy 3D server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Pirate Academy server:', err);
  process.exit(1);
});
