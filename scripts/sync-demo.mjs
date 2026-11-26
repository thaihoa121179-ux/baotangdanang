import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const pagePath = process.argv[2] || 'filehtml.html';
const [html, catalog, recognizer, chatKnowledge, chatScript, preview, frames] = await Promise.all([
  read(pagePath),
  read('data/artifacts.json'),
  read('js/recognize.js'),
  read('data/museum-chat.json'),
  read('js/museum-chat.js'),
  read('js/camera-preview.js'),
  read('data/scan-frames.json')
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
const photos = await Promise.all(JSON.parse(catalog).filter(record => record.photoFile).map(async record => {
  if (!/^images\/artifacts\/[a-z0-9-]+\.webp$/.test(record.photoFile)) {
    throw new Error(`Invalid artifact photo path: ${record.photoFile}`);
  }
  const bytes = await readFile(new URL(record.photoFile, root));
  return [record.photoKey, [`data:image/webp;base64,${bytes.toString('base64')}`, record.name, record.en?.title || record.name]];
}));
const withPhotos = inlineSection(withCatalog, 'COLLECTION PHOTOS',
  `    const COLLECTION_PHOTOS = ${inlineJson(JSON.stringify(Object.fromEntries(photos)))};`);
const script = recognizer.trimEnd().replace(/\nexport default MuseumRecognition;$/, '');
const withRecognition = inlineSection(withPhotos, 'RECOGNITION', script);
const guide = chatScript.trimEnd().replace(/\nexport \{ createMuseumChat \};$/, '');
const bundledChat = guide + `\n    const museumGuide = createMuseumChat(${inlineJson(chatKnowledge)});`;
const withChat = inlineSection(withRecognition, 'MUSEUM CHAT', bundledChat);
const camera = preview.trimEnd().replace(/\nexport default CameraPreview;$/, '');
const withCamera = inlineSection(withChat, 'CAMERA PREVIEW', camera);
const demoFrames = JSON.parse(frames);
const recordings = await Promise.all(demoFrames.frames.flatMap(frame => frame.items).map(async item => {
  if (!/^scan-[a-z0-9-]+$/.test(item.id)) throw new Error(`Invalid simulation id: ${item.id}`);
  const bytes = await readFile(new URL(`audio/scan-frames/${item.id}.mp3`, root));
  return [item.id, `data:audio/mpeg;base64,${bytes.toString('base64')}`];
}));
await writeFile(new URL(pagePath, root), inlineSection(withCamera, 'SIMULATION FRAMES',
  `    const EMBEDDED_SCAN_FRAMES = ${inlineJson(frames)};\n    const EMBEDDED_SCAN_AUDIO = ${JSON.stringify(Object.fromEntries(recordings))};`));
