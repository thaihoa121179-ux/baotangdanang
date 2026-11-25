import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const pagePath = process.argv[2] || 'filehtml.html';
const [html, catalog, recognizer] = await Promise.all([
  read(pagePath),
  read('data/artifacts.json'),
  read('js/recognize.js')
]);

function inlineSection(page, name, content) {
  const begin = `    // BEGIN EMBEDDED ${name}\n`;
  const end = `    // END EMBEDDED ${name}`;
  const start = page.indexOf(begin);
  const finish = page.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) throw new Error(`Missing HTML markers for ${name}`);
  return page.slice(0, start + begin.length) + content + '\n' + page.slice(finish);
}

const inlineCatalog = JSON.stringify(JSON.parse(catalog)).replace(/</g, '\\u003c');
const withCatalog = inlineSection(html, 'ARTIFACTS', `    const EMBEDDED_ARTIFACTS = ${inlineCatalog};`);
const script = recognizer.trimEnd().replace(/\nexport default MuseumRecognition;$/, '');
await writeFile(new URL(pagePath, root), inlineSection(withCatalog, 'RECOGNITION', script));
