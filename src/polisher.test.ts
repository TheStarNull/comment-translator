/**
 * Tests for the semantic polishing pipeline.
 *   npx tsc && node dist/polisher.test.js
 *
 * Stubs the LLM layer so the suite runs offline / without API keys.
 */
import { Polisher } from './polisher';
import * as P from './polisher';
import { LlmClient } from './llm-client';
import * as assert from 'assert';

let passed = 0;
let failed = 0;
function ok(name: string, cond: any) { if (cond) { passed++; } else { failed++; console.log('  ✗ ' + name); } }

async function main() {
  /* 1. rule cleanup (local, no LLM) */
  ok('collapse repeated punctuation', P.cleanupRules('将尺寸中的块设置为置换的状态。。\n\n\n', 'ZH') === '将尺寸中的块设置为置换的状态。');
  ok('strip engine prefix', !/翻译:/.test(P.cleanupRules('翻译: hello world  ', 'ZH')));
  ok('collapse blank lines / spaces', P.cleanupRules('a   b    c\n\n\n\nlined', 'EN') === 'a b c\n\nlined');
  ok('normalise trailing CJK punctuation', P.cleanupRules('错误末尾。，  ', 'ZH') === '错误末尾。');
  ok('trim trailing whitespace (per-line)', P.cleanupRules('结束.  ', 'JA').trim() === '结束。');

  /* 2. disabled passthrough */
  const off = new Polisher({ enabled: false });
  ok('disabled => passthrough', (await off.polish('anything')) === 'anything');

  /* 3. rules-only polish */
  const rules = new Polisher({ enabled: true, llm: false, rules: true, targetLang: 'ZH' });
  ok('rules-only runs', (await rules.polish('测试。  ')).trim() === '测试。');

  /* 4. style presets change the prompt */
  ok('formal mentions 正式', /正式/.test(P.buildSystemPrompt('formal', '简体中文')));
  ok('concise mentions 精简', /精简/.test(P.buildSystemPrompt('concise', '简体中文')));
  ok('tech-writing mentions 技术写作', /技术写作/.test(P.buildSystemPrompt('tech-writing', '简体中文')));
  ok('friendly mentions 初学者', /初学者/.test(P.buildSystemPrompt('friendly', '简体中文')));
  ok('prompt forbids extra commentary', /只输出/.test(P.buildSystemPrompt('formal', '简体中文')));
  ok('prompt protects identifiers', /BlockPermutation/.test(P.buildSystemPrompt('formal', '简体中文')));

  /* 5. language name mapping */
  ok('zh-cn => 简体中文', P.languageName('zh-cn') === '简体中文');
  ok('zh-tw => 繁体中文', P.languageName('zh-tw') === '繁体中文');
  ok('ja => 日语', P.languageName('ja') === '日语');
  ok('en => 英语', P.languageName('en') === '英语');
  ok('unknown => uppercased code', P.languageName('xx') === 'XX');

  /* 6. LLM fallback on error (rules still apply) */
  const boom = new Polisher({ enabled: true, llm: true, rules: true, targetLang: 'ZH' } as any);
  (boom as any).llmRewrite = async () => { throw new Error('boom'); };
  ok('fallback on LLM error => rules still run', !/。。/.test(await boom.polish('错误后。。   ')));

  /* 7. cache key isolation by style */
  const a = new Polisher({ enabled: true, llm: false, targetLang: 'ZH', style: 'formal' });
  const b = new Polisher({ enabled: true, llm: false, targetLang: 'ZH', style: 'concise' });
  const ka = (a as any).cacheKey('hello');
  const kb = (b as any).cacheKey('hello');
  ok('different styles => different cache keys', ka !== kb);
  ok('cache key contains style', ka.includes('formal') && kb.includes('concise'));

  /* 8. LlmClient Ollama URL normalisation */
  const ollama = new LlmClient({ provider: 'ollama', baseUrl: 'http://localhost:11434/' });
  ok('ollama baseUrl strips trailing slash', (ollama as any).baseUrl === 'http://localhost:11434');
  ok('ollama default model', (ollama as any).model === (process.env.OLLAMA_MODEL || 'qwen2.5'));
  const openai = new LlmClient({ provider: 'openai', baseUrl: 'https://api.openai.com/v1/' });
  ok('openai baseUrl strips trailing slash', (openai as any).baseUrl === 'https://api.openai.com/v1');

  /* 9. fromFlags helper */
  const f = Polisher.fromFlags({ polish: true, polishStyle: 'friendly', rulesOnly: true, targetLang: 'JA' });
  ok('fromFlags enabled', (f as any).enabled === true);
  ok('fromFlags rulesOnly => llm false', (f as any).useLlm === false);
  ok('fromFlags style', (f as any).style === 'friendly');

  console.log(`\n[polish] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
