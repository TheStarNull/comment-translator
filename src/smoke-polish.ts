/**
 * End-to-end smoke test: translation engine + polisher, with a fake translator
 * (no real API / no API key required). Verifies:
 *   - rules-only polish cleans up the translated text
 *   - LLM path is exercised when llmRewrite succeeds
 *   - LLM error => graceful fallback to rules (no crash)
 *   - polish results are persisted to the cache
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranslationEngine } from './engine';
import { ITranslator } from './translator';

let passed = 0, failed = 0;
const ok = (n: string, c: any) => { if (c) passed++; else { failed++; console.log('  ✗ ' + n); } };

class FakeTranslator implements ITranslator {
  calls = 0;
  constructor(_suffix: string) {}
  async translate(text: string): Promise<string> {
    this.calls++;
    // Simulate a "machine" translation with obvious roughness:
    // trailing spaces + doubled punctuation + a prefix the rules strip.
    return `翻译: ${text}。。 `;
  }
  async translateBatch(texts: string[]): Promise<string[]> {
    return Promise.all(texts.map(t => this.translate(t)));
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-polish-'));
  const src = path.join(tmp, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'a.ts'), `
/** 将尺寸中的块设置为置换的状态。 */
export class A { }
`);

  // --- 1. rules-only polish integrated into the engine -----------------
  const t1 = new FakeTranslator('x');
  const cacheDir = path.join(tmp, 'cache');
  const engine = new TranslationEngine({
    input: src,
    output: path.join(tmp, 'out'),
    translator: t1,
    extensions: ['.ts'],
    recursive: false,
    progress: false,
    verbose: false,
    polish: { enabled: true, style: 'tech-writing', llm: false, rules: true, targetLang: 'ZH', cacheDir },
  });
  await engine.run();
  const outFile = path.join(tmp, 'out', 'a.ts');
  const out1 = fs.readFileSync(outFile, 'utf-8');
  ok('rules-only: stripped trailing punctuation', !/。。/.test(out1));
  ok('rules-only: trimmed trailing spaces', !/ +\*?\s*$/m.test(out1.split('\n').filter(l => l.trim())[0] || ''));
  console.log('  [out1]', JSON.stringify(out1.replace(/\s+/g, ' ').trim()));

  // --- 2. LLM path: supply a polisher whose llmRewrite returns nicer text ---
  const t2 = new FakeTranslator('x');
  const engine2 = new TranslationEngine({
    input: src,
    output: path.join(tmp, 'out2'),
    translator: t2,
    extensions: ['.ts'],
    recursive: false,
    progress: false,
    verbose: false,
    polish: { enabled: true, style: 'formal', llm: true, rules: true, targetLang: 'ZH', cacheDir },
  });
  // Monkey-patch the polisher inside the engine to simulate a successful LLM.
  (engine2 as any).polisher.llmRewrite = async (text: string) => `润色后：${text.replace(/。+/, '。')}`;
  await engine2.run();
  const out2 = fs.readFileSync(path.join(tmp, 'out2', 'a.ts'), 'utf-8');
  ok('LLM path used (saw 润色后)', /润色后/.test(out2));
  console.log('  [out2]', JSON.stringify(out2.replace(/\s+/g, ' ').trim()));

  // --- 3. LLM throws => fallback to rules, no crash -------------------
  const t3 = new FakeTranslator('x');
  const engine3 = new TranslationEngine({
    input: src,
    output: path.join(tmp, 'out3'),
    translator: t3,
    extensions: ['.ts'],
    recursive: false,
    progress: false,
    verbose: false,
    polish: { enabled: true, style: 'tech-writing', llm: true, fallbackOnError: true, rules: true, targetLang: 'ZH', cacheDir },
  });
  (engine3 as any).polisher.llmRewrite = async () => { throw new Error('network down'); };
  let errored = false;
  try { await engine3.run(); } catch (e) { errored = true; }
  ok('LLM error => does NOT throw out of engine', !errored);
  const out3 = fs.readFileSync(path.join(tmp, 'out3', 'a.ts'), 'utf-8');
  ok('fallback => rules still applied', !/。。/.test(out3));
  console.log('  [out3]', JSON.stringify(out3.replace(/\s+/g, ' ').trim()));

  // --- 4. cache persistence: re-run hits disk, no new LLM calls -------
  // NOTE: isolated cache dir so we don't collide with the polish entries
  // written by case #1 (same style + targetLang + source text).
  const cacheDir4 = path.join(tmp, 'cache4');
  const t4 = new FakeTranslator('x');
  const llmCalls = { n: 0 };
  const llmMock = { chatCompletion: async () => { llmCalls.n++; return 'LLM_OK'; } };

  const engine4 = new TranslationEngine({
    input: src,
    output: path.join(tmp, 'out4'),
    translator: t4,
    extensions: ['.ts'],
    recursive: false,
    progress: false,
    verbose: false,
    polish: { enabled: true, style: 'tech-writing', llm: true, rules: true, targetLang: 'ZH', cacheDir: cacheDir4 },
  });
  (engine4 as any).polisher.llm = llmMock;
  await engine4.run();                 // 1st run: cold cache => calls LLM, populates cache
  const llmAfterFirst = llmCalls.n;    // snapshot immediately after 1st run
  ok('1st run called LLM at least once', llmAfterFirst >= 1);

  const engine4b = new TranslationEngine({
    input: src,
    output: path.join(tmp, 'out5'),
    translator: t4,
    extensions: ['.ts'],
    recursive: false,
    progress: false,
    verbose: false,
    polish: { enabled: true, style: 'tech-writing', llm: true, rules: true, targetLang: 'ZH', cacheDir: cacheDir4 },
  });
  (engine4b as any).polisher.llm = llmMock;
  await engine4b.run();                // 2nd run: cache hit => LLM NOT called again
  ok('2nd run: polish cache hit => LLM not called again', llmCalls.n === llmAfterFirst);
  const files = fs.readdirSync(cacheDir4).filter(f => f.includes('polish'));
  ok('polish cache file exists', files.length > 0);
  console.log('  [cache]', files, `| llmCalls=${llmCalls.n}`);

  console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
