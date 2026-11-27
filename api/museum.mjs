import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import worker from '../docs/cloudflare-worker.mjs';

const publicOrigin = 'https://baotangdanang.vercel.app';
const catalogPath = new URL('../data/artifacts.json', import.meta.url);
let catalog;

// The limits count requests per warm Vercel instance. The Gemini project also has its own quota.
const attemptsByVisitor = new Map();
let resetAt = 0;
let totalAttempts = 0;
const recognitionLimit = {
  async limit({ key }) {
    const now = Date.now();
    if (now >= resetAt) {
      resetAt = now + 60_000;
      attemptsByVisitor.clear();
      totalAttempts = 0;
    }
    const attempts = attemptsByVisitor.get(key) ?? 0;
    if (attempts >= 10 || totalAttempts >= 40) return { success: false };
    attemptsByVisitor.set(key, attempts + 1);
    totalAttempts++;
    return { success: true };
  }
};

export default async function handleMuseum(request, response) {
  const operation = new URL(request.url, publicOrigin).searchParams.get('operation');
  if (!['chat', 'scan'].includes(operation)) {
    response.statusCode = 404;
    response.end();
    return;
  }

  const headers = new Headers(request.headers);
  headers.set('CF-Connecting-IP', headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown');
  const options = { method: request.method, headers };
  if (request.method === 'POST') {
    options.body = Readable.toWeb(request);
    options.duplex = 'half';
  }
  const env = {
    ALLOWED_ORIGINS: `${publicOrigin},https://thaihoa121179-ux.github.io`,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_CHAT_MODEL: process.env.GEMINI_CHAT_MODEL,
    RECOGNITION_LIMIT: recognitionLimit
  };
  if (operation === 'scan' && request.method === 'POST' && env.GEMINI_API_KEY) {
    catalog ??= readFile(catalogPath, 'utf8').then(JSON.parse);
    env.CATALOG = await catalog;
  }
  const upstream = await worker.fetch(new Request(`${publicOrigin}/${operation}`, options), env);
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(await upstream.text());
}
