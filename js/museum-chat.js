function createMuseumChat(knowledge) {
  const topics = new Map(knowledge.topics.map(topic => [topic.id, topic]));
  const defaultTopics = ['hours', 'short-tour', 'floor-1', 'history-1858'];
  const pick = (pair, lang) => pair[lang === 'en' ? 1 : 0];
  const localized = (record, lang) => lang === 'en' ? { ...record, ...record.en } : record;

  function normalize(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function oneEditApart(left, right) {
    if (left === right) return true;
    if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
    if (left.length > right.length) return oneEditApart(right, left);
    let index = 0;
    while (index < left.length && left[index] === right[index]) index++;
    if (left.length !== right.length) return left.slice(index) === right.slice(index + 1);
    return left.slice(index + 1) === right.slice(index + 1)
      || (left[index] === right[index + 1] && left[index + 1] === right[index] && left.slice(index + 2) === right.slice(index + 2));
  }

  function aliasMatch(query, aliases, allowTypos = false) {
    let strongest = 0;
    const words = query.split(' ');
    for (const original of aliases) {
      if (!original) continue;
      const alias = normalize(original);
      if (!alias) continue;
      const parts = alias.split(' ');
      const weight = parts.length * 2 + Math.min(alias.length, 45) / 50;
      if (` ${query} `.includes(` ${alias} `)) {
        strongest = Math.max(weight, strongest);
      } else if (allowTypos && alias.length >= 5 && parts.length <= 3) {
        for (let start = 0; start + parts.length <= words.length; start++) {
          const changes = parts.filter((part, offset) => part !== words[start + offset]);
          if (changes.length === 1 && parts.every((part, offset) => oneEditApart(part, words[start + offset]))) {
            strongest = Math.max(weight - 1.65, strongest);
          }
        }
      }
    }
    return strongest;
  }

  function artifactMatches(query, catalog) {
    return [...catalog.values()].map(record => ({
      record,
      score: aliasMatch(query, [
        ...(knowledge.artifacts[record.id]?.aliases || []),
        record.name, record.shortName, record.en?.shortName, record.en?.title
      ], true)
    })).filter(match => match.score > 0).sort((a, b) => b.score - a.score);
  }

  function topicMatches(query) {
    return [...topics.values()].map(topic => ({ topic, score: aliasMatch(query, [...topic.aliases, ...topic.question]) }))
      .filter(match => match.score > 0).sort((a, b) => b.score - a.score);
  }

  function artifactIntent(query) {
    if (/\b(hinh anh|xem anh|cho xem|show me|show the|photo|picture)\b/.test(query)) return 'card';
    if (/^(?:nghe|cho nghe)$|\b(nghe (?:narration|thuyet minh|doc|giong doc)|cho (?:minh )?nghe|audio|read aloud|listen)\b/.test(query)) return 'audio';
    if (/\b(chat lieu|vat lieu|bang gi|duoc duc bang|lam tu gi|made of|material|carved from)\b/.test(query)) return 'material';
    if (/\b(dung de|cong dung|dung lam gi|de lam gi|vai tro|used for|purpose|what did .+ do|cach dung)\b/.test(query)) return 'purpose';
    if (/\b(chi duong|vi tri|o dau|tang nao|tang may|where|which floor|directions|location|nam o)\b/.test(query)) return 'location';
    if (/\b(nien dai|bao nhieu tuoi|bao nhieu nam|co tu khi nao|co tu bao gio|nam nao|the ky nao|bao lau roi|how old|what century|date from|when was)\b/.test(query)) return 'era';
    if (/\b(ai chi huy|ai lanh dao|gan voi (?:vi|ai)|who led|which general|nguon goc|lich su)\b/.test(query)) return 'history';
    if (/\b(tai sao|vi sao|vi vay|the sao|vay sao|tai sao the|why|ke tiep|noi ro|chi tiet|tell me more|more about it)\b/.test(query)) return 'detail';
    if (/\b(ai lam ra|ai duc|ai che tac|ai tao ra|who made|who created)\b/.test(query)) return 'maker';
    if (/\b(nang bao nhieu|kich thuoc|can nang|dai bao nhieu|weight|weigh|dimensions|how big)\b/.test(query)) return 'dimensions';
    return null;
  }

  function artifactReply(record, intent, lang) {
    const art = localized(record, lang);
    const facts = knowledge.artifacts[record.id] || {};
    const base = { artifactId: record.id };
    if (!intent || intent === 'card') return { ...base, card: true };
    if (intent === 'audio') return { ...base, text: pick([
      `Mình có phần thuyết minh về ${art.shortName}. Bấm Nghe audio bên dưới nhé.`,
      `There’s a narration for ${art.shortName}. Tap Listen to audio below.`
    ], lang), audio: true };
    if (intent === 'location') {
      const text = art.floor ? pick([
        `Bạn tìm ${art.shortName} ở tầng ${art.floor}, khu ${art.room.replace(/\s*[-•]\s*Tầng \d+$/i, '')}.`,
        `Look for ${art.shortName} in ${art.room}.`
      ], lang) : pick([
        `${art.shortName} thuộc bộ ảnh minh họa. Mình chưa có vị trí trưng bày cụ thể cho mục này.`,
        `${art.shortName} is in the illustrated set. I don’t have a display location for this item.`
      ], lang);
      return { ...base, text, floor: art.floor, mapNodeId: art.mapNodeId };
    }
    if (intent === 'era') return { ...base, text: art.era ? pick([
      `${art.shortName} có niên đại theo danh mục là ${art.era}.`,
      `The catalog dates ${art.shortName} to ${art.era}.`
    ], lang) : pick([
      `Danh mục chưa ghi niên đại cụ thể cho ${art.shortName}. Mình có thể kể thêm về công dụng hoặc hình dáng của nó.`,
      `The catalog doesn’t give an exact date for ${art.shortName}. I can tell you about its purpose or appearance.`
    ], lang) };
    const detail = facts[intent] ?? (intent === 'detail' ? facts.purpose : null);
    const text = detail ? pick(detail, lang)
      : intent === 'purpose' || intent === 'detail' ? art.fullDesc
      : pick([
        `Mình chưa có thông tin đủ cụ thể về phần này của ${art.shortName}. Bạn có thể xem nhãn trưng bày hoặc hỏi mình về một chi tiết khác.`,
        `I don’t have that specific detail about ${art.shortName}. You can check the display label or ask me about another feature.`
      ], lang);
    return { ...base, text };
  }

  function topicReply(topic, lang) {
    return {
      topicId: topic.id,
      text: pick(topic.answer, lang),
      source: topic.source,
      floor: topic.floor,
      map: topic.map
    };
  }

  function socialReply(query, name, lang) {
    const responses = [
      [/^(?:he lo+|he+lo+|hello+|helo+|hi+|hey+|alo+|xin chao|chao)(?: (?:ban|nha|nhe|nho|a|moi nguoi|bot|there|everyone))*$/, [
        `Hế lô${name ? ', ' + name : ''}! Rất vui gặp bạn 😊 Hôm nay bạn muốn đi một vòng bảo tàng hay nghe mình kể một chuyện lạ về hiện vật?`,
        `Hi${name ? ', ' + name : ''}! Lovely to meet you 😊 Fancy a quick tour or a little story about one of the objects?`
      ]],
      [/^(?:cam on|cam on ban|cam on nha|cam on nhieu|thank you|thanks|thank you so much)(?: (?:nhe|a|ban|nha))?$/, [
        'Không có gì nha! Bạn hỏi tiếp bất cứ khi nào thấy một chi tiết thú vị nhé.',
        'You’re welcome! Ask me anytime you spot an interesting detail.'
      ]],
      [/^(?:tam biet|bye|goodbye|hen gap lai|see you)(?: (?:nhe|a|ban|later))?$/, [
        'Hẹn gặp lại bạn nhé! Chúc bạn có một chuyến tham quan thật vui.',
        'See you next time! I hope you enjoy your museum visit.'
      ]],
      [/^(?:ban la ai|ban ten gi|ten ban la gi|ban la robot a|who are you|what is your name|are you a bot)$/, [
        'Mình là hướng dẫn viên số của Bảo tàng Đà Nẵng. Mình có thể kể chuyện hiện vật, gợi ý đường đi hoặc cùng bạn tìm hiểu một chủ đề mới.',
        'I’m Da Nang Museum’s digital guide. I can tell you about the objects, suggest a route or help you explore another topic.'
      ]],
      [/^(?:ban khoe khong|khoe khong|how are you|how are you doing)$/, [
        'Mình sẵn sàng đi tham quan cùng bạn rồi 😊 Còn bạn hôm nay muốn xem gì trước?',
        'Ready for a museum visit 😊 What would you like to see first?'
      ]],
      [/^(?:ban co cam xuc khong|ban co buon khong|noi chuyen voi minh|can you chat|do you have feelings)$/, [
        'Mình là hướng dẫn viên số, nhưng mình có thể trò chuyện cùng bạn. Bạn muốn nghe một chuyện thú vị hay đang muốn tâm sự một chút?',
        'I’m a digital guide, and I’m happy to keep you company. Would you like a little museum story or a chat?'
      ]],
      [/^(?:chan qua|minh chan|chan ghe|hoi chan|minh met|met qua|i am bored|i m bored|i m tired)$/, [
        'Mình hiểu, xem lâu cũng dễ mệt. Hay mình chọn một món nhỏ thôi? Khuyên tai hai đầu thú có vài chi tiết nhìn lướt qua rất dễ bỏ sót.',
        'A long visit can get tiring. How about one small object? The two-headed earring has details that are easy to miss at first glance.'
      ]],
      [/^(?:tra loi sai|ban tra loi sai|ban khong hieu|sai roi|ban kho qua|bot kho qua|that is wrong|that s wrong|you misunderstood)$/, [
        'Cảm ơn bạn đã nói. Mình có thể đã hiểu sai ý. Bạn thử nói tên món đồ hoặc chi tiết đang hỏi, mình sẽ trả lời sát hơn.',
        'Thanks for pointing that out. I may have misunderstood. Tell me the object or detail you mean and I’ll try again.'
      ]]
    ];
    const match = responses.find(([pattern]) => pattern.test(query));
    return match ? { text: pick(match[1], lang), keepContext: true, social: true } : null;
  }

  function lookupSubject(raw) {
    const clean = raw.trim().replace(/[?!.]+$/, '').trim();
    const patterns = [
      /^(.+?)\s+(?:là\s+(?:ai|gì)|la\s+(?:ai|gi))$/iu,
      /^(?:ai\s+(?:là|la)|(?:giải thích|giai thich|kể về|ke ve|tìm hiểu về|tim hieu ve))\s+(.+)$/iu,
      /^(?:what (?:is|are)|who (?:is|was)|tell me about|explain)\s+(.+)$/iu,
      /^(.+?)\s+(?:nghĩa là gì|nghia la gi)$/iu
    ];
    const subject = patterns.map(pattern => clean.match(pattern)?.[1]).find(Boolean)?.trim();
    if (!subject || subject.length < 2 || subject.length > 90 || /[\n\r@<>:]/.test(subject)) return null;
    if (/^(?:a |an |the )?(?:this|that|it|you|i|he|she|they|my|your|tôi|mình|bạn|nó|cái (?:này|đó|kia))(?:\s|$)/iu.test(subject)) return null;
    if (/\b(hom nay|thoi tiet|today|weather|bao nhieu tien|ty gia)\b/.test(normalize(subject))) return null;
    return subject.replace(/^(?:a|an|the)\s+/i, '');
  }

  function answer(raw, { context, catalog, lang, name }) {
    const q = normalize(raw);
    const social = socialReply(q, name, lang);
    if (social) return social;

    const intent = artifactIntent(q);
    const explicit = artifactMatches(q, catalog);
    const relatedTopics = topicMatches(q);
    const top = relatedTopics[0];
    const reference = lang === 'en'
      ? /\b(it|that one|this one|this artifact|that artifact)\b/.test(q)
      : /\b(no|mon (?:do|nay|kia|ay)|cai (?:do|nay|kia|ay)|hien vat (?:do|nay|ay)|vay|the)\b/.test(q);
    const abbreviated = q.split(' ').length <= 7 && !top;
    const recent = (reference || abbreviated) && intent ? catalog.get(context.artifactId) : null;
    const compare = /\b(so sanh|khac nhau|vs|compare|difference between)\b/.test(q);
    if (compare && explicit.length > 1) {
      const [first, second] = explicit.slice(0, 2).map(({ record }) => localized(record, lang));
      return {
        artifactId: first.id,
        text: `${first.shortName}: ${first.shortDesc}\n${second.shortName}: ${second.shortDesc}`
      };
    }

    const plan = relatedTopics.find(({ topic }) => ['address', 'hours', 'tickets', 'contact'].includes(topic.id));
    const asksHoursAndTickets = relatedTopics.some(({ topic }) => topic.id === 'hours')
      && relatedTopics.some(({ topic }) => topic.id === 'tickets');
    if (asksHoursAndTickets) {
      const hours = topicReply(topics.get('hours'), lang);
      const tickets = topicReply(topics.get('tickets'), lang);
      return { ...tickets, text: `${hours.text}\n${tickets.text}` };
    }

    const best = explicit[0];
    const named = best?.record;
    const isExhibitSource = context.artifactId === named?.id;
    const followArtifact = named && (intent === 'card' || intent === 'audio'
      || !top || best.score >= top.score
      || (isExhibitSource && intent && top.topic.id.startsWith('floor-')));
    if (followArtifact) return artifactReply(named, intent, lang);
    if (recent && (!top || (top.topic.id === 'tour' && reference))) {
      return artifactReply(recent, intent, lang);
    }
    if (top) return topicReply(plan?.topic ?? top.topic, lang);
    if (context.topicId === 'tickets' && /^(?:vay )?(?:bao nhieu|how much|con sinh vien|what about students)/.test(q)) {
      return topicReply(topics.get('tickets'), lang);
    }

    const subject = !named && !reference ? lookupSubject(raw) : null;
    const text = context.artifactId ? pick([
      'Mình chưa chắc ý bạn đang hỏi phần nào của hiện vật. Bạn thử nói rõ chi tiết, hoặc chọn một câu bên dưới nhé.',
      'I’m not sure which part of the artifact you mean. Try naming the detail, or pick a question below.'
    ], lang) : pick([
      'Mình chưa có thông tin chắc về câu đó. Bạn thử nói rõ tên người, địa điểm hoặc hiện vật đang hỏi nhé.',
      'I don’t have a reliable answer for that yet. Try naming the person, place or object you mean.'
    ], lang);
    return { text, subject, keepContext: true, social: true };
  }

  function suggestions(context, catalog, lang) {
    const artifact = catalog.get(context.artifactId);
    if (artifact) {
      const result = [];
      if (knowledge.artifacts[artifact.id]?.purpose) result.push(pick(['Món này dùng để làm gì?', 'What was it used for?'], lang));
      if (knowledge.artifacts[artifact.id]?.material) result.push(pick(['Nó làm bằng gì?', 'What is it made of?'], lang));
      if (artifact.floor) result.push(pick(['Món này ở tầng mấy?', 'Which floor is it on?'], lang));
      if (artifact.era) result.push(pick(['Món này có từ bao giờ?', 'How old is it?'], lang));
      const next = knowledge.artifacts[artifact.id]?.next ?? defaultTopics;
      return [...result.slice(0, 3), ...next.slice(0, 2).map(id => pick(topics.get(id).question, lang))].slice(0, 4);
    }
    const ids = topics.get(context.topicId)?.next ?? defaultTopics;
    return ids.map(id => pick(topics.get(id).question, lang));
  }

  async function searchWikipedia(subject, lang, signal) {
    const wikiLanguage = lang === 'en' ? 'en' : 'vi';
    const endpoint = new URL(`https://${wikiLanguage}.wikipedia.org/w/api.php`);
    endpoint.search = new URLSearchParams({
      action: 'query', prop: 'extracts|pageprops', ppprop: 'disambiguation', exintro: '1',
      explaintext: '1', exsentences: '2', titles: subject, redirects: '1',
      format: 'json', formatversion: '2', origin: '*'
    });
    const response = await fetch(endpoint, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const body = await response.json();
    const article = body.query?.pages?.[0];
    if (article?.missing || article?.pageprops?.disambiguation !== undefined || typeof article?.title !== 'string'
      || typeof article.extract !== 'string' || !article.extract.trim()) return null;
    const title = encodeURIComponent(article.title.replaceAll(' ', '_'));
    return {
      text: article.extract.trim().slice(0, 750),
      source: `https://${wikiLanguage}.wikipedia.org/wiki/${title}`
    };
  }

  return { answer, suggestions, searchWikipedia };
}

export { createMuseumChat };
