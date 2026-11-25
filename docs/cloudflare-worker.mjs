import recognition from '../js/recognize.js';

const MAX_BODY_BYTES = 512 * 1024;

async function readImage(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_image');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('image_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const { image } = JSON.parse(text + decoder.decode());
  if (image?.mimeType !== 'image/jpeg' || typeof image.data !== 'string'
      || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4 !== 0) {
    throw new Error('invalid_image');
  }
  return { mimeType: 'image/jpeg', data: image.data };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (!origin || !allowedOrigins.includes(origin)) return reply({ error: 'origin_rejected' }, 403);
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
      return reply({ error: 'unsupported_content_type' }, 415);
    }
    if (!env.GEMINI_API_KEY || !env.CATALOG_URL || !env.RECOGNITION_LIMIT) return reply({ error: 'unconfigured' }, 503);

    const client = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RECOGNITION_LIMIT.limit({ key: client });
    if (!success) return reply({ error: 'rate_limited' }, 429);

    let image;
    try {
      image = await readImage(request);
    } catch (error) {
      if (error.message === 'image_too_large') return reply({ error: 'image_too_large' }, 413);
      return reply({ error: 'invalid_image' }, 400);
    }

    const signal = AbortSignal.timeout(7400);
    try {
      const catalogURL = new URL(env.CATALOG_URL);
      if (catalogURL.protocol !== 'https:') return reply({ error: 'unconfigured' }, 503);
      const response = await fetch(catalogURL, {
        signal, redirect: 'error', cf: { cacheEverything: true, cacheTtl: 30 }
      });
      if (!response.ok) return reply({ error: 'catalog_unavailable' }, 502);
      const catalog = recognition.catalogRows(await response.json());
      if (!catalog.length) return reply({ error: 'catalog_unavailable' }, 502);

      const model = env.GEMINI_MODEL || recognition.CONFIG.MODEL;
      const { candidates } = await recognition.callGemini(image, catalog, model, env.GEMINI_API_KEY, signal);
      return reply({ detections: candidates });
    } catch (error) {
      if (signal.aborted) return reply({ error: 'timeout' }, 504);
      if (error.message === 'quota_or_rate_limit') return reply({ error: 'quota_or_rate_limit' }, 429);
      return reply({ error: 'recognition_failed' }, 502);
    }
  }
};
