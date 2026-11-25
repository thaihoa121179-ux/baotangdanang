const MuseumRecognition = (() => {
  const CONFIG = Object.freeze({
    MODEL: 'gemini-3.5-flash-lite',
    PROXY_ENDPOINT: '',
    TIMEOUT_MS: 8000
  });

  const PROMPT_A = `Bạn là bộ nhận diện hiện vật cho ứng dụng hướng dẫn bảo tàng. Bạn KHÔNG giải thích, KHÔNG mô tả, KHÔNG viết lời thuyết minh. Nhiệm vụ duy nhất: xác định ảnh người dùng gửi khớp với hiện vật nào trong DANH SÁCH.

QUY TẮC:
1. Chỉ được chọn id có trong DANH SÁCH bên dưới. Tuyệt đối không tạo id mới.
2. Ảnh có thể chứa nhiều hiện vật. Trả về tất cả hiện vật nhận ra được, tối đa 5, sắp xếp từ chắc chắn nhất.
3. Mỗi kết quả có "confidence" từ 0 đến 1. Nếu bạn không chắc chắn (dưới 0.5) thì không đưa vào kết quả.
4. Ảnh bị phản chiếu, thiếu sáng, chụp qua kính vẫn cố nhận diện, nhưng hạ confidence tương ứng.
5. Nếu không khớp hiện vật nào, trả về danh sách rỗng. Không đoán bừa.
6. Chỉ trả về JSON hợp lệ theo đúng định dạng, không thêm chữ nào khác, không dùng markdown.

ĐỊNH DẠNG TRẢ VỀ:
{"detections":[{"id":"<id trong danh sách>","confidence":0.0}]}

DANH SÁCH HIỆN VẬT (id | tên | mô tả hình dáng để nhận ra):
{{CATALOG}}`;

  function catalogRows(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(row => row && typeof row.id === 'string'
      && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)
      && typeof row.name === 'string' && row.name.trim()
      && typeof row.visualDesc === 'string' && [1, 2].includes(row.frame));
  }

  function buildRequest(image, catalog) {
    const cell = text => text.replace(/[\r\n|]/g, ' ').trim();
    const lines = catalog.map(row => [row.id, row.name, row.visualDesc].map(cell).join(' | '));
    return {
      systemInstruction: { parts: [{ text: PROMPT_A.replace('{{CATALOG}}', () => lines.join('\n')) }] },
      contents: [{ role: 'user', parts: [{ inlineData: image }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          required: ['detections'],
          properties: {
            detections: {
              type: 'ARRAY',
              maxItems: 5,
              items: {
                type: 'OBJECT',
                required: ['id', 'confidence'],
                properties: {
                  id: { type: 'STRING', enum: [...new Set(catalog.map(row => row.id))] },
                  confidence: { type: 'NUMBER', minimum: 0, maximum: 1 }
                }
              }
            }
          }
        }
      }
    };
  }

  function parseDetections(body, catalog) {
    if (!Array.isArray(body?.detections)) throw new Error('invalid_response');
    const ids = new Set(catalog.map(row => row.id));
    const scores = new Map();
    for (const item of body.detections) {
      if (!ids.has(item?.id) || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) continue;
      scores.set(item.id, Math.max(item.confidence, scores.get(item.id) ?? 0));
    }
    const candidates = [...scores].map(([id, confidence]) => ({ id, confidence }))
      .sort((a, b) => b.confidence - a.confidence);
    return {
      detections: candidates.filter(item => item.confidence >= 0.5).slice(0, 5),
      candidates: candidates.slice(0, 5)
    };
  }

  function normalizeEndpoint(value) {
    if (!value.trim()) return '';
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid_endpoint');
    return url.href;
  }

  function jpegFrame(source) {
    const width = source.videoWidth || source.naturalWidth;
    const height = source.videoHeight || source.naturalHeight;
    if (!width || !height) throw new Error('invalid_image');
    // Live video uses object-fit: cover, so crop to the same centered viewfinder.
    const ratio = source.videoWidth && source.clientHeight
      ? source.clientWidth / source.clientHeight : width / height;
    const cropWidth = Math.min(width, height * ratio);
    const cropHeight = Math.min(height, width / ratio);
    const scale = Math.min(1, 768 / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, (width - cropWidth) / 2, (height - cropHeight) / 2,
      cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const prefix = 'data:image/jpeg;base64,';
    const jpeg = canvas.toDataURL('image/jpeg', 0.7);
    if (!jpeg.startsWith(prefix)) throw new Error('invalid_image');
    return { mimeType: 'image/jpeg', data: jpeg.slice(prefix.length) };
  }

  async function postJSON(url, body, signal, headers = {}) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'quota_or_rate_limit' : 'http_error');
    return response.json();
  }

  async function callGemini(image, catalog, model, key, signal) {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(model)) throw new Error('invalid_model');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = await postJSON(url, buildRequest(image, catalog), signal, { 'x-goog-api-key': key });
    const parts = body?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new Error('invalid_response');
    const json = parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    try {
      return parseDetections(JSON.parse(json), catalog);
    } catch {
      throw new Error('invalid_response');
    }
  }

  async function recognize(image, catalog, { endpoint = CONFIG.PROXY_ENDPOINT, key, signal, onCatalog } = {}) {
    const url = normalizeEndpoint(endpoint);
    if (!url && !key) throw new Error('unconfigured');
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(CONFIG.TIMEOUT_MS);
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      // On Pages, JSON is canonical. The bundle is also usable as a single local HTML file.
      if (['https:', 'http:'].includes(location.protocol)) {
        const catalogDeadline = AbortSignal.any([deadline, AbortSignal.timeout(1200)]);
        try {
          const response = await fetch('./data/artifacts.json', { cache: 'no-cache', signal: catalogDeadline });
          if (response.ok) {
            const latest = catalogRows(await response.json());
            if (latest.length) catalog = onCatalog ? onCatalog(latest) : latest;
          }
        } catch {
          deadline.throwIfAborted();
        }
      }
      if (!url) return await callGemini(image, catalog, CONFIG.MODEL, key, deadline);
      const body = await postJSON(url, { image }, deadline);
      return parseDetections(body, catalog);
    } catch (error) {
      if (timeout.aborted) throw new Error('timeout');
      throw error;
    }
  }

  return { CONFIG, catalogRows, jpegFrame, normalizeEndpoint, parseDetections, callGemini, recognize };
})();

export default MuseumRecognition;
