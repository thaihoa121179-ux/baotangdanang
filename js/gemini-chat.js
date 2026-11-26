const GeminiChat = (() => {
  const MODEL = 'gemini-3.5-flash-lite';
  const TIMEOUT_MS = 8000;
  const MISSING_ACCENTS = 'vietnamese_accents_missing';
  const languageNames = { vi: 'Vietnamese', en: 'English', ja: 'Japanese' };
  const vietnameseStyle = 'Trả lời bằng tiếng Việt chuẩn, viết đầy đủ dấu thanh và dấu chữ (ă, â, đ, ê, ô, ơ, ư), kể cả khi khách gõ không dấu hoặc các tin nhắn trước không có dấu. Ví dụ: “Chào bạn! Bạn muốn tìm hiểu thêm về Bảo tàng Đà Nẵng không?” Giữ nguyên chính tả của tên riêng nước ngoài, thuật ngữ và nội dung trích dẫn.';

  function normalizeInput(value) {
    const question = typeof value?.question === 'string' ? value.question.trim() : '';
    if (!question || question.length > 400) throw new Error('invalid_question');
    const language = Object.hasOwn(languageNames, value.language) ? value.language : 'vi';
    const history = Array.isArray(value.history) ? value.history.slice(-4).filter(turn =>
      ['user', 'model'].includes(turn?.role) && typeof turn.text === 'string' && turn.text.trim()
    ).map(({ role, text }) => ({ role, text: text.trim().slice(0, 900) })) : [];
    return { question, language, history };
  }

  function answerText(value) {
    const text = typeof value === 'string' ? value.trim().normalize('NFC').slice(0, 1800) : '';
    if (!text) throw new Error('empty_answer');
    return text;
  }

  function needsVietnameseAccents(text, language) {
    if (language !== 'vi' || /[đ\u0300\u0301\u0302\u0303\u0306\u0309\u031b\u0323]/i.test(text.normalize('NFD'))) return false;
    if (/\b(?:bao tang|chao ban|xin chao|cam on|da nang|co the)\b/i.test(text)) return true;
    const words = text.toLowerCase().match(/\b(?:ban|chua|chuyen|cua|dang|duoc|giup|khong|minh|mot|nay|nguoi|nhung|theo|thong|trong|voi)\b/g);
    return new Set(words).size >= 2;
  }

  async function post(url, body, signal, headers = {}) {
    const response = await fetch(url, {
      method: 'POST', body: JSON.stringify(body), signal,
      credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json', ...headers }
    });
    if (response.status === 422 && (await response.json())?.error === MISSING_ACCENTS) throw new Error(MISSING_ACCENTS);
    if (!response.ok) throw new Error(response.status === 429 ? 'quota_or_rate_limit' : 'chat_unavailable');
    return response.json();
  }

  async function generate(input, key, signal, model = MODEL) {
    const { question, language, history } = normalizeInput(input);
    const instructions = `You are the digital guide for Da Nang Museum. Reply in ${languageNames[language]}, in plain text without markdown or links. Use 2–5 concise sentences in a friendly tone. Interpret casual spelling when clear, and answer every part of the question when possible. Answer general knowledge questions if you are confident. The app already answers from its verified museum data before calling you. Do not invent museum holdings, locations, opening hours, prices or sources. If you cannot verify a museum-specific detail from the conversation, say so and invite the visitor to ask museum staff. Historical objects may be discussed as museum artifacts. Avoid instructions for building or operating weapons.`;
    const contents = [...history, { role: 'user', text: question }].map(({ role, text }) => ({ role, parts: [{ text }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const systemText = language === 'vi' ? `${instructions}\n\n${vietnameseStyle}` : instructions;
    async function ask(prompt) {
      const response = await post(url, {
        systemInstruction: { parts: [{ text: prompt }] }, contents,
        generationConfig: { maxOutputTokens: 1024 }
      }, signal, { 'x-goog-api-key': key });
      const parts = response?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) throw new Error('empty_answer');
      return answerText(parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join(''));
    }

    const text = await ask(systemText);
    if (!needsVietnameseAccents(text, language)) return text;
    const corrected = await ask(`${systemText}\n\nCâu trả lời trước bị thiếu dấu. Hãy trả lời lại câu hỏi gốc bằng tiếng Việt có đầy đủ dấu, kiểm tra từng câu trước khi gửi.`);
    if (needsVietnameseAccents(corrected, language)) throw new Error(MISSING_ACCENTS);
    return corrected;
  }

  function proxyUrl(endpoint) {
    const url = new URL('/chat', endpoint);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_endpoint');
    return url;
  }

  async function request(input, { endpoint, key }, signal) {
    if (endpoint) {
      const chat = normalizeInput(input);
      const result = await post(proxyUrl(endpoint), chat, signal);
      const text = answerText(result?.text);
      if (needsVietnameseAccents(text, chat.language)) throw new Error(MISSING_ACCENTS);
      return text;
    }
    if (!key) throw new Error('unconfigured');
    return generate(input, key, signal);
  }

  return { MODEL, TIMEOUT_MS, MISSING_ACCENTS, normalizeInput, generate, request };
})();

export default GeminiChat;
