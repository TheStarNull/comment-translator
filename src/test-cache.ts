/**
 * 测试翻译缓存 + 断点续跑
 * 运行: npx ts-node test-cache.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { CachedTranslator } from './cached-translator';
import { MockTranslator } from './mock-translator';

const CACHE_DIR = path.resolve(__dirname, '.comment-translator-cache-test');

// 清理旧缓存，保证测试纯净
if (fs.existsSync(CACHE_DIR)) {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

// 用 MockTranslator 模拟远端（每次调用计数，可判断是否真的请求了 API）
const mock = new MockTranslator({ targetLanguage: 'zh', sourceLanguage: 'en' });
const cached = new CachedTranslator(mock, {
  cacheDir: CACHE_DIR,
  backend: 'mock',
  sourceLang: 'en',
  targetLang: 'zh',
  verbose: true,
});

async function main() {
  const texts = [
    'Hello world',
    'This is a test',
    'Another segment',
    'Hello world', // 故意重复，验证去重
  ];

  console.log('===== 第 1 次运行（全部未命中，应请求 API） =====');
  const r1 = await cached.translateBatch(texts);
  console.log('结果:', r1);
  console.log('API 调用次数:', mock.callCount); // 应为 3（去重后）
  cached.printStats();

  console.log('\n===== 第 2 次运行（全部命中缓存，API 调用次数不变） =====');
  mock.reset(); // 重置计数器
  const r2 = await cached.translateBatch(texts);
  console.log('结果:', r2);
  console.log('API 调用次数:', mock.callCount); // 应为 0
  cached.printStats();

  console.log('\n===== 模拟「中断后重跑」：新建 CachedTranslator 加载同一缓存目录 =====');
  mock.reset();
  const cached2 = new CachedTranslator(mock, {
    cacheDir: CACHE_DIR,
    backend: 'mock',
    sourceLang: 'en',
    targetLang: 'zh',
    verbose: true,
  });
  const r3 = await cached2.translateBatch(['Hello world', 'New text']); // 1 条命中 + 1 条未命中
  console.log('结果:', r3);
  console.log('API 调用次数:', mock.callCount); // 应为 1（仅 "New text"）
  cached2.printStats();

  // 清理测试缓存
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  console.log('\n✅ 测试完成，已清理临时缓存');
}

main().catch(console.error);
