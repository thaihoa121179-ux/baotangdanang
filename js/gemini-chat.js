const GeminiChat = (() => {
  const MODEL = 'gemini-3.5-flash-lite';
  const TIMEOUT_MS = 8000;
  const languageNames = { vi: 'Vietnamese', en: 'English', ja: 'Japanese' };

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
    const text = typeof value === 'string' ? value.trim().slice(0, 1800) : '';
    if (!text) throw new Error('empty_answer');
    return text;
  }

  async function post(url, body, signal, headers = {}) {
    const response = await fetch(url, {
      method: 'POST', body: JSON.stringify(body), signal,
      credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json', ...headers }
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'quota_or_rate_limit' : 'chat_unavailable');
    return response.json();
  }

  async function generate(input, key, signal, model = MODEL) {
    const { question, language, history } = normalizeInput(input);
    const instructions = `You are the digital guide for Da Nang Museum. Reply in ${languageNames[language]}, in plain text without markdown or links. Use 2–5 concise sentences in a friendly tone. Interpret casual spelling when clear, and answer every part of the question when possible. Answer general knowledge questions if you are confident. The app already answers from its verified museum data before calling you. Do not invent museum holdings, locations, opening hours, prices or sources. If you cannot verify a museum-specific detail from the conversation, say so and invite the visitor to ask museum staff. Historical objects may be discussed as museum artifacts. Avoid instructions for building or operating weapons.`;
    const contents = [...history, { role: 'user', text: question }].map(({ role, text }) => ({ role, parts: [{ text }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await post(url, {
      systemInstruction: { parts: [{ text: instructions }] }, contents,
      generationConfig: { maxOutputTokens: 1024 }
    }, signal, { 'x-goog-api-key': key });
    if (!Array.isArray(response?.candidates?.[0]?.content?.parts)) throw new Error('empty_answer');
    const parts = response.candidates[0].content.parts;
    return answerText(parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join(''));
  }

  function proxyUrl(endpoint) {
    const url = new URL('/chat', endpoint);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_endpoint');
    return url;
  }

  async function request(input, { endpoint, key }, signal) {
    if (endpoint) {
      const result = await post(proxyUrl(endpoint), normalizeInput(input), signal);
      return answerText(result?.text);
    }
    if (!key) throw new Error('unconfigured');
    return generate(input, key, signal);
  }

  return { MODEL, TIMEOUT_MS, normalizeInput, generate, request };
})();

export default GeminiChat;
