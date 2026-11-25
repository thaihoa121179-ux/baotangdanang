import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const pagePath = process.argv[2] || 'filehtml.html';
const [html, catalog, recognizer, chatKnowledge, chatScript] = await Promise.all([
  read(pagePath),
  read('data/artifacts.json'),
  read('js/recognize.js'),
  read('data/museum-chat.json'),
  read('js/museum-chat.js')
]);

function inlineSection(page, name, content) {
  const begin = `    // BEGIN EMBEDDED ${name}\n`;
  const end = `    // END EMBEDDED ${name}`;
  const start = page.indexOf(begin);
  const finish = page.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) throw new Error(`Missing HTML markers for ${name}`);
  return page.slice(0, start + begin.length) + content + '\n' + page.slice(finish);
}

const inlineJson = text => JSON.stringify(JSON.parse(text)).replace(/</g, '\\u003c');
const withCatalog = inlineSection(html, 'ARTIFACTS', `    const EMBEDDED_ARTIFACTS = ${inlineJson(catalog)};`);
const script = recognizer.trimEnd().replace(/\nexport default MuseumRecognition;$/, '');
const withRecognition = inlineSection(withCatalog, 'RECOGNITION', script);
const guide = chatScript.trimEnd().replace(/\nexport \{ createMuseumChat \};$/, '');
const bundledChat = guide + `\n    const museumGuide = createMuseumChat(${inlineJson(chatKnowledge)});`;
await writeFile(new URL(pagePath, root), inlineSection(withRecognition, 'MUSEUM CHAT', bundledChat));
