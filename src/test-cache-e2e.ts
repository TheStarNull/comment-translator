/**
 * 端到端测试：模拟真实 CLI 运行 + 中断 + 续跑
 * 1. 用 MockTranslator 翻译一批文件
 * 2. 模拟中断（只翻译部分）
 * 3. 重新运行 → 已翻译的从缓存命中，只翻译剩余的
 */
import * as fs from 'fs';
import * as path from 'path';
import { TranslationEngine } from './engine';
import { MockTranslator } from './mock-translator';
import { ITranslator } from './translator';

const TMP = path.resolve(__dirname, '.e2e-test');
const CACHE = path.resolve(__dirname, '.comment-translator-cache-e2e');
const SRC = path.join(TMP, 'src');

function cleanup() {
  for (const p of [TMP, CACHE]) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
}

function setupSourceFiles() {
  fs.mkdirSync(SRC, { recursive: true });
  const files = [
    { name: 'a.ts', content: `/**\n * Hello world\n * This is file A\n */\nexport const a = 1;` },
    { name: 'b.ts', content: `/**\n * Hello world\n * This is file B\n */\nexport const b = 2;` },
    { name: 'c.ts', content: `/**\n * Hello world\n * This is file C\n */\nexport const c = 3;` },
  ];
  for (const f of files) fs.writeFileSync(path.join(SRC, f.name), f.content);
}

async function main() {
  cleanup();
  setupSourceFiles();

  const mock = new MockTranslator({ targetLanguage: 'zh', sourceLanguage: 'en' });

  console.log('===== 第 1 次运行（翻译 a.ts、b.ts，模拟中断） =====');

  // 第一次：只处理 a.ts 和 b.ts（通过 --output 单独跑两个文件模拟中断）
  for (const file of ['a.ts', 'b.ts']) {
    const engine = new TranslationEngine({
      input: path.join(SRC, file),
      output: path.join(TMP, 'out', file),
      translator: mock as ITranslator,
      cache: { cacheDir: CACHE },
      backend: 'mock',
      targetLang: 'zh',
      recursive: false,
      progress: false,
      verbose: false,
    });
    await engine.run();
  }

  console.log(`\n[After run 1] Mock API calls: ${mock.callCount}`);

  console.log('\n===== 第 2 次运行（续跑 c.ts + 重跑 a.ts/b.ts → 全部命中缓存） =====');
  mock.reset();

  for (const file of ['a.ts', 'b.ts', 'c.ts']) {
    const engine = new TranslationEngine({
      input: path.join(SRC, file),
      output: path.join(TMP, 'out', file),
      translator: mock as ITranslator,
      cache: { cacheDir: CACHE },
      backend: 'mock',
      targetLang: 'zh',
      recursive: false,
      progress: false,
      verbose: false,
    });
    await engine.run();
  }

  console.log(`\n[After run 2] Mock API calls: ${mock.callCount}`);
  console.log('\n✅ 预期: run1 ≈ 4 次调用（2 文件 × 2 句/文件），run2 = 2 次（仅 c.ts 的 2 句，a/b 全部缓存命中）');
  console.log('   若 run2 API 调用 = 2，则断点续跑工作正常 ✅');

  cleanup();
}

main().catch(e => { console.error(e); process.exit(1); });
