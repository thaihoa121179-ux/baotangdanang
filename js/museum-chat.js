function createMuseumChat(knowledge) {
  const topics = new Map(knowledge.topics.map(topic => [topic.id, topic]));
  const defaultTopics = ['hours', 'short-tour', 'floor-1', 'history-1858'];
  const conversationPrompts = {
    listen: ['Muốn tâm sự', 'I’d like to talk'],
    story: ['Kể chuyện vui', 'Tell me a story'],
    quiz: ['Đố mình đi', 'Give me a riddle'],
    anotherStory: ['Kể chuyện khác đi', 'Tell me another story'],
    anotherQuiz: ['Thêm một câu đố nữa', 'Give me another riddle'],
    hint: ['Cho mình gợi ý', 'Give me a hint'],
    reveal: ['Cho mình xem đáp án', 'Show me the answer'],
    tour: ['Hỏi về bảo tàng', 'Back to the museum']
  };
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
        ...(record.aliases || []),
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
    if (/\b(?:tim thay (?:o|tai) dau|khai quat (?:o|tai) dau|where (?:was|were) .+ (?:found|excavated))\b/.test(query)) return 'history';
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
    const facts = { ...knowledge.artifacts[record.id], ...record.facts };
    const base = { artifactId: record.id, source: record.source };
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
        `Bảo tàng có hồ sơ về ${art.shortName}. Mình chưa xác nhận được vị trí trưng bày cụ thể.`,
        `The museum has a record for ${art.shortName}. I don’t have a confirmed display location for this item.`
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

  function conversationReply(query, { context, lang, name }) {
    const reply = (pair, chatMode, patch = {}) => ({
      text: pick(pair, lang),
      keepContext: true,
      social: true,
      ...(chatMode !== undefined ? { contextPatch: { chatMode, ...patch } } : {})
    });
    const is = (key, pattern) => conversationPrompts[key].some(text => normalize(text) === query) || pattern.test(query);
    const breaks = knowledge.chatBreaks;
    const set = breaks[context.quizIndex] ?? breaks[0];

    if (is('tour', /^(?:doi chu de|quay lai(?: bao tang)?|hoi ve bao tang|back to the museum|change the subject)$/)) {
      return reply([
        'Mình quay lại chuyện bảo tàng nhé. Bạn chọn một câu bên dưới hoặc hỏi điều bạn đang tò mò.',
        'Back to the museum. Pick a question below or tell me what you’re curious about.'
      ], null);
    }

    if (is('listen', /^(?:tam su(?: chut)?|muon tam su|minh muon tam su|minh muon ke them|cho minh tam su|noi chuyen voi minh|muon noi chuyen|can we talk|i need to talk|can i tell you something)$/)) {
      return reply([
        'Bạn kể từ đoạn nào thấy dễ nhất nhé. Chuyện gì làm bạn bận lòng hôm nay?',
        'Start wherever it feels easiest. What has been on your mind today?'
      ], 'listening');
    }

    if (is('story', /^(?:ke (?:minh )?(?:nghe )?(?:mot )?chuyen (?:vui|la|thu vi)|ke chuyen di|ke gi do di|noi gi vui di|tell me a story)$/)
      || is('anotherStory', /^(?:ke chuyen khac|another story)$/)
      || (context.chatMode === 'story' && /^(?:ke tiep|ke tiep di|tell me more)$/.test(query))) {
      const storyIndex = ((context.storyIndex ?? -1) + 1) % breaks.length;
      return reply(breaks[storyIndex].story, 'story', { storyIndex });
    }

    if (is('quiz', /^(?:do minh di|cho (?:minh )?(?:mot )?cau do(?: nho)?|cau do|do vui(?: di)?|give me a (?:quick )?riddle)$/)
      || is('anotherQuiz', /^(?:cau khac di|do tiep di|another riddle|one more riddle)$/)) {
      const quizIndex = ((context.quizIndex ?? -1) + 1) % breaks.length;
      return reply(breaks[quizIndex].question, 'quiz', { quizIndex, quizHint: false });
    }

    if (context.chatMode === 'quiz') {
      if (is('hint', /^(?:goi y|goi y di|minh khong biet|khong biet nua|i don t know|hint)$/)) {
        return reply(set.hint, 'quiz', { quizHint: true });
      }
      if (is('reveal', /^(?:dap an|dap an di|chiu(?: roi)?|bo cuoc|tell me the answer|i give up)$/)) {
        return reply(set.explanation, 'quiz-done');
      }
      const guess = query.replace(/^(?:minh doan|tui doan|chac la|i guess|i think it s) /, '').replace(/ (?:a|ha|dung khong)$/, '');
      const matches = words => words.some(word => normalize(word) === guess);
      if (matches([...set.choices[set.correct], ...set.alsoAccept])) {
        return reply([`Chuẩn rồi! ${set.explanation[0]}`, `You got it! ${set.explanation[1]}`], 'quiz-done');
      }
      if (set.choices.some(matches)) {
        return reply([`Chưa đúng, thử thêm lần nữa nhé. ${set.hint[0]}`, `Good try. Here’s a clue: ${set.hint[1]}`], 'quiz', { quizHint: true });
      }
    }

    const casual = query.replace(/\b(?:wa+|qa+|qoa+|qua+)\b/g, 'qua')
      .replace(/^(?:(?:minh|tui|toi|tao|to|em|hom nay|nay|dang|thay|cam thay|tu nhien|hoi|rat|qua|i m|i am|i feel|feeling|really|very|so|a bit|kind of) )+/, '');
    const qualifiers = '(?: (?:qua|ghe|lam|lom|vai|qua di|di|nhe|nha|ne|a|luon|that|vay|he|roi|right now|today|so much|really))*';
    const mood = pattern => new RegExp(`^(?:${pattern})${qualifiers}(?: (?:vi|because) .+)?$`).test(casual);
    const sad = mood('bu+o+n+|bu+n+|tut mood|tam trang te|sad|down|upset|muon khoc|feeling down');
    const firstPerson = /\b(minh|tui|toi|to|em|cua (?:minh|tui|toi)|i|my)\b/.test(query);
    const talking = ['listening', 'sad', 'bored', 'tired', 'worried'].includes(context.chatMode);
    const generalQuestion = /^(?:vi sao|tai sao|what is|what are|why|who is|how) /.test(query);
    const personal = firstPerson || sad || /^(?:moi|vua|bi) /.test(query) || (talking && !generalQuestion);
    if (personal && /\b(diem (?:kem|thap|xau)|bi diem kem|thi rot|rot mon|trut ky thi|failed (?:the |an )?exam|bad grade|bad grades)\b/.test(query)) {
      return reply([
        'Nhận điểm thấp dễ làm mình hụt hẫng. Bạn đang tiếc vì kết quả hay lo điều gì sẽ tới sau đó?',
        'Getting a low grade can be discouraging. Are you most disappointed about the result, or worried about what comes next?'
      ], 'listening');
    }
    if (personal && /\b(cai nhau|gian (?:minh|tui|toi)|chia tay|that tinh|bi bo roi|argued with|broke up|had a fight)\b/.test(query)) {
      return reply([
        'Chuyện với người mình quý có thể làm mình nghĩ mãi. Điều gì trong chuyện đó khiến bạn buồn nhất?',
        'Something happening with a person you care about can stay on your mind. What part of it hurt the most?'
      ], 'listening');
    }
    if (personal && /\b(bi mang|bi la|so (?:bo me|ba me|cha me)|getting in trouble)\b/.test(query)) {
      return reply([
        'Nghe như bạn đang lo người nhà sẽ phản ứng thế nào. Bạn muốn kể điều khiến bạn lo nhất, hay thử cùng mình nghĩ một cách mở lời?',
        'It sounds like you’re worried about how they might react. Would you like to talk about that, or think of a way to start the conversation?'
      ], 'listening');
    }
    if (personal && /\b(co don|lac long|khong ai hieu|khong co ai de noi|lonely|left out|nobody understands)\b/.test(query)) {
      return reply([
        'Cảm giác một mình có thể nặng nề thật. Bạn đang muốn có người nghe, hay muốn mình giúp bạn nghĩ xem có thể mở lời với ai?',
        'Feeling alone can be heavy. Would it help to talk here, or would you like to think of someone you could reach out to?'
      ], 'listening');
    }
    if (sad) {
      return reply([
        'Ôi, mình nghe nè. Chuyện gì làm bạn buồn vậy? Bạn cứ kể nếu thấy thoải mái nha.',
        'It sounds like today has been a bit rough. If you’d like to talk, I’m here to listen. What’s been weighing on you?'
      ], 'sad');
    }
    if (mood('chan+|nan+|chan nan|chan hoc|bored|nothing to do')) {
      return reply([
        'Chán ghê ha. Hay mình đổi không khí một chút? Mình có một câu đố ngắn hoặc một chuyện hay trong bảo tàng.',
        'A change of pace might be nice. How about a quick riddle or a little museum story?'
      ], 'bored');
    }
    if (mood('met+|doi suc|buon ngu|het nang luong|tired|exhausted|sleepy')) {
      return reply([
        'Nghe như bạn cần nghỉ một nhịp. Mình có thể kể một chuyện ngắn, hoặc bạn cứ tạm dừng một chút nha.',
        'It sounds like you could use a pause. I can tell you a short story, or we can take a break.'
      ], 'tired');
    }
    if (mood('lo|lo lang|ap luc|stress|cang thang|worried|stressed')) {
      return reply([
        'Có chuyện gì làm bạn lo nhất lúc này? Mình có thể cùng bạn nghĩ từng việc một.',
        'What is worrying you most right now? We can think it through one thing at a time.'
      ], 'worried');
    }
    if (mood('vui|vui ve|mung|happy|excited') || /\b(minh|tui|toi|i) (?:vua )?(?:thi dau|thi do|duoc diem cao|passed my exam)\b/.test(query)) {
      return reply([
        'Vui lây với bạn luôn! Có chuyện gì hay vậy, kể mình nghe với 😊',
        'That sounds lovely! What happened? I’d like to hear the good news 😊'
      ], 'happy');
    }

    const hesitant = /^(?:khong biet(?: nua)?|chang biet nua|ko biet(?: nua)?|k biet(?: nua)?|i don t know|not sure)$/;
    const acknowledge = /^(?:u|uh|um|uk|ok|oke|okay|co|yes|yeah)(?: (?:a|nha|nhe|ne))?$/;
    const leave = /^(?:thoi|ke di|bo qua(?: di)?|khong muon ke|k muon ke|khong sao|never mind|rather not)$/;
    if (talking && hesitant.test(query)) {
      return reply([
        'Không sao, có lúc khó gọi tên cảm giác lắm. Bạn muốn kể một chút về hôm nay hay đổi không khí bằng chuyện khác?',
        'That’s okay. Feelings can be hard to name. Would you rather talk a little about today or switch to a lighter subject?'
      ], 'listening');
    }
    if (talking && acknowledge.test(query)) {
      return reply([
        'Ừ, mình nghe đây. Bạn kể từ chuyện gần đây nhất mà bạn nhớ cũng được.',
        'I’m listening. You can start with the most recent thing you remember.'
      ], 'listening');
    }
    if (context.chatMode && leave.test(query)) {
      return reply([
        'Được nha. Mình để đó một chút. Nếu muốn đổi không khí, thử chọn một câu chuyện hoặc câu đố bên dưới.',
        'Of course. We can leave it there. If you want a change of pace, try a story or riddle below.'
      ], 'bored');
    }

    const responses = [
      [/^(?:he lo+|he+lo+|hello+|helo+|hi+|hey+|alo+|xin chao|chao)(?: (?:ban|nha|nhe|nho|a|moi nguoi|bot|there|everyone))*$/, [
        `Hế lô${name ? ', ' + name : ''}! Rất vui gặp bạn 😊 Hôm nay bạn muốn đi một vòng bảo tàng hay nghe mình kể một chuyện lạ về hiện vật?`,
        `Hi${name ? ', ' + name : ''}! Lovely to meet you 😊 Fancy a quick tour or a little story about one of the objects?`
      ]],
      [/^(?:cam on|cam on ban|cam on nha|cam on nhieu|thank you|thanks|thank you so much)(?: (?:nhe|a|ban|nha))?$/, [
        'Không có gì nha! Cảm ơn bạn đã trò chuyện với mình.',
        'You’re welcome! Thanks for chatting with me.'
      ]],
      [/^(?:tam biet|bye|goodbye|hen gap lai|see you)(?: (?:nhe|a|ban|later))?$/, [
        'Hẹn gặp lại bạn nhé!',
        'See you next time!'
      ]],
      [/^(?:ban la ai|ban ten gi|ten ban la gi|ban la robot a|who are you|what is your name|are you a bot)$/, [
        'Mình là hướng dẫn viên số của Bảo tàng Đà Nẵng. Mình có thể kể chuyện hiện vật, gợi ý đường đi hoặc cùng bạn tìm hiểu một chủ đề mới.',
        'I’m Da Nang Museum’s digital guide. I can tell you about the objects, suggest a route or help you explore another topic.'
      ]],
      [/^(?:ban khoe khong|khoe khong|how are you|how are you doing)$/, [
        'Mình sẵn sàng đi tham quan cùng bạn rồi 😊 Còn bạn hôm nay thế nào?',
        'Ready for a museum visit 😊 How are you doing today?'
      ]],
      [/^(?:ban co cam xuc khong|ban co buon khong|can you chat|do you have feelings)$/, [
        'Mình là hướng dẫn viên số. Bạn muốn trò chuyện một chút hay nghe mình kể chuyện về một hiện vật?',
        'I’m a digital guide. Would you like a chat or a little story about an artifact?'
      ]],
      [/^(?:tra loi sai|ban tra loi sai|ban khong hieu|sai roi|ban kho qua|bot kho qua|that is wrong|that s wrong|you misunderstood)$/, [
        'Cảm ơn bạn đã nói. Bạn chỉ giúp mình chỗ nào chưa đúng, mình sẽ thử trả lời lại sát hơn.',
        'Thanks for pointing that out. Show me which part was off and I’ll try again.'
      ]]
    ];
    const match = responses.find(([pattern]) => pattern.test(query));
    return match ? reply(match[1]) : null;
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
    if (/\b(hom nay|thoi tiet|today|weather|bao nhieu tien|ty gia|cua (?:minh|tui|toi|em|ban)|my|our)\b/.test(normalize(subject))) return null;
    return subject.replace(/^(?:a|an|the)\s+/i, '');
  }

  function answer(raw, { context, catalog, lang, name }) {
    const q = normalize(raw);
    const social = conversationReply(q, { context, lang, name });
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
    if (!subject && ['sad', 'listening', 'worried'].includes(context.chatMode) && q && !/^(?:ai|cai gi|vi sao|tai sao|khi nao|what|why|when|who|where|how) /.test(q)) {
      return {
        text: pick([
          'Cảm ơn bạn đã kể. Bạn muốn mình nghe thêm, hay mình cùng nghĩ một việc nhỏ có thể làm ngay bây giờ?',
          'Thanks for sharing that. Would you like to talk more, or think of one small thing you can do right now?'
        ], lang),
        contextPatch: { chatMode: 'listening' },
        keepContext: true,
        social: true
      };
    }
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
    const { chatMode, quizIndex, quizHint } = context;
    const prompts = keys => keys.map(key => pick(conversationPrompts[key], lang));
    if (chatMode === 'quiz' && knowledge.chatBreaks[quizIndex]) {
      const choices = knowledge.chatBreaks[quizIndex].choices.map(pair => pick(pair, lang));
      return [...choices, ...prompts([quizHint ? 'reveal' : 'hint'])];
    }
    if (chatMode === 'quiz-done') return prompts(['anotherQuiz', 'story', 'tour']);
    if (chatMode === 'story') return prompts(['anotherStory', 'quiz', 'tour']);
    if (['sad', 'listening', 'worried', 'happy'].includes(chatMode)) return prompts(['listen', 'story', 'quiz']);
    if (['bored', 'tired'].includes(chatMode)) return prompts(['story', 'quiz', 'tour']);

    const artifact = catalog.get(context.artifactId);
    if (artifact) {
      const result = [];
      const facts = { ...knowledge.artifacts[artifact.id], ...artifact.facts };
      if (facts.purpose) result.push(pick(['Món này dùng để làm gì?', 'What was it used for?'], lang));
      if (facts.material) result.push(pick(['Nó làm bằng gì?', 'What is it made of?'], lang));
      if (artifact.floor) result.push(pick(['Món này ở tầng mấy?', 'Which floor is it on?'], lang));
      if (facts.dimensions) result.push(pick(['Món này có kích thước bao nhiêu?', 'What are its dimensions?'], lang));
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
