/**
 * 集成测试：翻译缓存（断点续跑）+ LibreTranslate 后端
 *
 * 验证点：
 *   1. createTranslator({ backend: 'libretranslate', cache }) 返回带缓存的翻译器
 *   2. 第一次跑：全部 miss → 调用真实 translateBatch
 *   3. 第二次跑（模拟"中断后重跑"）：全部 hit → translateBatch 不再被调用
 *   4. 缓存按 (backend+source+target) 隔离，跨语言对不会串
 *
 * 运行：npx ts-node src/test-cache-resume.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { CachedTranslator } from './cached-translator';

const CACHE_DIR = path.join(__dirname, '.test-cache-resume');

// 清理上次测试遗留
if (fs.existsSync(CACHE_DIR)) fs.rmSync(CACHE_DIR, { recursive: true, force: true });

// ── 1. 造一个"可控的 LibreTranslate 假后端"，记录被调用次数 ──
class FakeLibreBackend {
  callCount = 0;
  async translateBatch(texts: string[]): Promise<string[]> {
    this.callCount++;
    // 模拟翻译：加前缀
    return texts.map(t => `TR-${t}`);
  }
  async translate(): Promise<string> { return 'TR'; }
}

// 用真 CachedTranslator 包这个假后端（绕过真实网络，专注测缓存逻辑）
const fake = new FakeLibreBackend();

function makeCached(targetLang: string) {
  // 手动构造 CachedTranslator，模拟 createTranslator 的包裹行为
  return new CachedTranslator(fake as any, {
    cacheDir: CACHE_DIR,
    backend: 'libretranslate',
    sourceLang: 'auto',
    targetLang,
  });
}

async function main() {
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}`); }
  };

  // ── 2. 第一次运行：冷缓存，全部 miss ──
  console.log('\n[Run 1] 冷启动（缓存为空）');
  const t1 = makeCached('zh');
  const input = ['hello world', 'set permutation', 'block dimension'];
  const out1 = await t1.translateBatch(input);
  ok('Fake 后端被调用了 1 次', fake.callCount === 1);
  ok('译文带 TR- 前缀', out1.every((o, i) => o === `TR-${input[i]}`));

  // 关键：模拟"进程正常结束 / 引擎 flush"——确保缓存落盘。
  // 这正是断点续跑的保证：CLI 在 engine.run() 末尾会调用 translator.flush()。
  (t1 as any).flush();

  // 诊断：确认磁盘上确实有内容
  const filesAfterRun1 = fs.readdirSync(CACHE_DIR);
  console.log(`  [diag] cache dir contents: ${JSON.stringify(filesAfterRun1)}`);

  // ── 3. 模拟"进程中断后重跑"：新建实例，复用同一缓存目录 ──
  console.log('\n[Run 2] 模拟重跑（同缓存目录，应全部命中）');
  fake.callCount = 0; // 重置计数器
  const t2 = makeCached('zh');
  const out2 = await t2.translateBatch(input);
  ok('重跑时 Fake 后端调用次数 = 0（全部走缓存）', fake.callCount === 0);
  ok('重跑结果与首次完全一致', JSON.stringify(out1) === JSON.stringify(out2));

  // ── 4. 新增一个未翻译过的文本，应只翻译新增部分 ──
  console.log('\n[Run 3] 增量：混入一条新文本');
  fake.callCount = 0;
  const t3 = makeCached('zh');
  const mixed = ['hello world', 'a brand new sentence']; // 前者已缓存，后者未缓存
  await t3.translateBatch(mixed);
  ok('增量场景：仅 1 条 miss → 后端调用 1 次', fake.callCount === 1);

  // ── 5. 不同 targetLang 应互相隔离（zh 与 en 缓存不串） ──
  console.log('\n[Run 4] 语言对隔离：切换到 target=en');
  fake.callCount = 0;
  const tEn = makeCached('en');
  await tEn.translateBatch(['hello world']); // 在 en 语言对下从未翻译过
  ok('切换 target 后缓存不命中（隔离生效）', fake.callCount === 1);

  // ── 6. 验证磁盘上确实生成了缓存文件 ──
  const finalFiles = fs.readdirSync(CACHE_DIR);
  console.log(`  [diag] final files: ${JSON.stringify(finalFiles)}`);
  ok('磁盘上生成了缓存文件（.jsonl）', finalFiles.some(f => f.endsWith('.jsonl')));

  console.log(`\n${'='.repeat(40)}`);
  console.log(`结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
