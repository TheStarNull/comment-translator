/**
 * Semantic polishing pass for translated comments.
 *
 * Why a separate pass (not a translator backend):
 *   The translator's job is "text in language A → text in language B". Polishing
 *   is "take the translation and make it read like it was written by a human
 *   technical writer". It runs AFTER translation (and after term restoration),
 *   so it sees the final text with all placeholders already resolved back to
 *   their original identifiers / URLs / code spans.
 *
 * What it does (three layers, user-selectable):
 *   1. Prompt-based LLM polish
 *        Sends each segment with a system prompt like
 *        "You are a technical-documentation translator. Output natural, fluent
 *         <target>, keep code / placeholders intact, no extra commentary."
 *        — the LLM does NOT see the placeholders (they were restored to real
 *          identifiers by the TermProtector), so we add a guard instruction to
 *          preserve them.
 *   2. Post-translation rule cleanup (local, zero cost)
 *        - collapse repeated spaces / blank lines
 *        - unify punctuation (。。. → 。, ，, → ，, fix trailing 「。.»)
 *        - normalize full-width parentheses matched pairs
 *        - strip stray 「翻译:」/「译文:」 prefixes some engines prepend
 *        - sentence-case the first letter of a prose line where appropriate
 *   3. Style presets
 *        formal | tech-writing | concise | friendly
 *        (only the LLM prompt wording changes; rules always apply)
 *
 * Caching: the result is cached keyed by (sourceText + style + targetLang),
 * so a re-run with --polish hits disk and never calls the LLM twice for the
 * same segment. Lives in the same TranslationCache store.
 *
 * Usage:
 *   const polisher = new Polisher({ enabled: true, style: 'tech-writing', ... });
 *   const out = await polisher.polish('将尺寸中的块设置为置换的状态。', { source: '...' });
 */

import { LlmClient, LlmClientOptions } from './llm-client';
import { TranslationCache } from './translation-cache';

export type PolishStyle = 'formal' | 'tech-writing' | 'concise' | 'friendly';

export interface PolisherOptions {
  /** Master switch. When false, polish() is a no-op (passthrough). */
  enabled?: boolean;
  /** Style preset. Default 'tech-writing'. */
  style?: PolishStyle;
  /** LLM-based rewrite. Default true (set false for rules-only, zero API cost). */
  llm?: boolean;
  /** Local rule cleanup. Default true. */
  rules?: boolean;
  /** Whether the LLM call is allowed to fall back to rules-only on error. Default true. */
  fallbackOnError?: boolean;

  // LLM connection (passed straight to LlmClient)
  provider?: 'openai' | 'ollama';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;

  /** Target language (ZH / JA / zh-CN ...). Informs the prompt + cache key. */
  targetLang?: string;
  /** Source text (original, pre-translation). Only used by the LLM for context. */
  sourceText?: string;

  /** Cache directory. Set => polish results are persisted & re-used across runs. */
  cacheDir?: string;
  /** Disable reading/writing the polish cache. */
  noCache?: boolean;
}

export class Polisher {
  readonly enabled: boolean;
  readonly style: PolishStyle;
  private readonly useLlm: boolean;
  private readonly useRules: boolean;
  private readonly fallbackOnError: boolean;
  private readonly targetLang: string;
  private readonly sourceText: string;

  private llm: LlmClient | null = null;
  private cache: TranslationCache | null = null;

  constructor(opts: PolisherOptions = {}) {
    this.enabled = opts.enabled ?? false;
    this.style = opts.style ?? 'tech-writing';
    this.useLlm = opts.llm ?? true;
    this.useRules = opts.rules ?? true;
    this.fallbackOnError = opts.fallbackOnError ?? true;
    this.targetLang = opts.targetLang ?? 'ZH';
    this.sourceText = opts.sourceText ?? '';

    if (this.enabled && this.useLlm) {
      const llmOpts: LlmClientOptions = {
        provider: opts.provider,
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        model: opts.model,
        temperature: opts.temperature,
      };
      this.llm = new LlmClient(llmOpts);
    }

    if (this.enabled && !opts.noCache) {
      const dir = opts.cacheDir ?? '.comment-translator-cache';
      this.cache = new TranslationCache({
        cacheDir: dir,
        backend: 'polish',
        sourceLang: 'any', // polish cache key includes style + target, source is irrelevant
        targetLang: this.targetLang.toLowerCase(),
      });
    }
  }

  /** Convenience: build a Polisher from loose CLI-ish flags. */
  static fromFlags(flags: {
    polish?: boolean;
    polishStyle?: PolishStyle;
    llmProvider?: 'openai' | 'ollama';
    llmBaseUrl?: string;
    llmApiKey?: string;
    llmModel?: string;
    rulesOnly?: boolean;
    targetLang?: string;
    sourceText?: string;
    cacheDir?: string;
    noCache?: boolean;
  }): Polisher {
    return new Polisher({
      enabled: flags.polish ?? false,
      style: flags.polishStyle,
      llm: flags.rulesOnly ? false : true,
      provider: flags.llmProvider,
      baseUrl: flags.llmBaseUrl,
      apiKey: flags.llmApiKey,
      model: flags.llmModel,
      targetLang: flags.targetLang,
      sourceText: flags.sourceText,
      cacheDir: flags.cacheDir,
      noCache: flags.noCache,
    });
  }

  /**
   * Polish a single translated segment.
   * - no-op when disabled
   * - cache lookup → on miss: LLM (optional) → rule cleanup → cache write
   */
  async polish(text: string): Promise<string> {
    if (!this.enabled) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    const cacheKey = this.cacheKey(trimmed);

    if (this.cache) {
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
    }

    let out = trimmed;

    if (this.useLlm && this.llm) {
      try {
        out = await this.llmRewrite(trimmed);
      } catch (e: any) {
        if (!this.fallbackOnError) throw e;
        // fall through to rules-only
      }
    }

    if (this.useRules) {
      out = cleanupRules(out, this.targetLang);
    }

    if (this.cache) this.cache.set(cacheKey, out);
    return out;
  }

  /** Polish a batch, de-duplicating along the way. */
  async polishBatch(texts: string[]): Promise<string[]> {
    if (!this.enabled) return texts;
    return Promise.all(texts.map(t => this.polish(t)));
  }

  /** Persist any pending cache writes (call on shutdown). */
  flush(): void {
    this.cache?.flushSync();
  }

  // ---- internals ---------------------------------------------------------

  private cacheKey(text: string): string {
    // include style so "formal" vs "concise" don't collide; reuse the shared
    // hash helper so cache files interop with the translator cache.
    const h = TranslationCache.hash(`${this.style}::${this.targetLang.toLowerCase()}::${text}`);
    return `polish:${this.style}:${this.targetLang.toLowerCase()}:${h}`;
  }

  protected async llmRewrite(text: string): Promise<string> {
    const langName = languageName(this.targetLang);
    const systemPrompt = buildSystemPrompt(this.style, langName);
    const userContent = this.sourceText
      ? `原文（仅供参考，不要照抄）:\n${this.sourceText}\n\n译文（请润色）:\n${text}`
      : text;

    const result = await this.llm!.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);

    return result || text; // never return empty
  }
}

/* ================================================================== */
/*  Rule-based cleanup (local, runs after the LLM)                     */
/* ================================================================== */

export function cleanupRules(text: string, targetLang: string): string {
  let out = text;

  // 1. strip common "translation engine" prefixes
  out = out.replace(/^\s*(翻译[:：]|译文[:：]|Translated[::]?)\s*/i, '');

  // 2. collapse 3+ newlines to 2 (preserve paragraph breaks, kill runs)
  out = out.replace(/\n{3,}/g, '\n\n');

  // 3. collapse repeated spaces / tabs (but keep leading whitespace per line)
  out = out
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' '))
    .join('\n');

  // 4. language-aware punctuation normalisation
  if (isCJK(targetLang)) {
    out = normalizeCjkPunctuation(out);
    // final sweep: strip stray Latin punctuation glued to a CJK closer
    out = out.replace(/。[,，.]+/g, '。').replace(/[，,][，,]+/g, '，');
  }

  // 5. trim trailing spaces per line
  out = out
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();

  return out;
}

function isCJK(lang: string): boolean {
  const l = lang.toLowerCase();
  return ['zh', 'ja', 'ko', 'zh-cn', 'zh-tw', 'zh-hant', 'ja-jp', 'ko-kr'].includes(l);
}

function normalizeCjkPunctuation(s: string): string {
  return s
    // ellipsis variants → …
    .replace(/\.{3,}/g, '…')
    .replace(/。{2,}/g, '。')
    // stray punctuation at end: 「。.» 「。，」 → 「。」
    .replace(/([。！？])[。，,、]+(?=[」'")]|$)/g, '$1')
    // 。, → 。   ，, → ，
    .replace(/([，、；：])\1+/g, '$1')
    // english comma/period right after CJK → CJK counterpart
    .replace(/([\u4e00-\u9fff\u3000-\u303f])\.(?!\.)/g, '$1。')
    .replace(/([\u4e00-\u9fff\u3000-\u303f]),/g, '$1，')
    // balanced full-width parens normalisation (only if both present)
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/* ================================================================== */
/*  Prompt construction                                                */
/* ================================================================== */

export function buildSystemPrompt(style: PolishStyle, langName: string): string {
  const base = [
    `你是一名资深技术文档译者，负责把代码注释 / JSDoc 翻译成自然、流畅的${langName}。`,
    `要求：`,
    `1. 只输出润色后的${langName}译文，不要任何解释、引号包裹、前缀或额外对话。`,
    `2. 严格保留原文中的代码标识符、API 名称、参数名、类型名（如 BlockPermutation、setPermutation）、反引号代码块、占位符（%s / ${'$'}{name}）以及 JSDoc 内联标签（{@link ...}），逐字不动。`,
    `3. 保留原文的行数结构与缩进：每段对应一行，空行照留，星号前缀（*）由外层处理，此处不要添加。`,
    `4. 若原文是列表 / 枚举式注释，译文保持同样的项目符号与顺序。`,
  ].join('\n');

  const styleNote: Record<PolishStyle, string> = {
    formal: '5. 语气正式、书面，避免口语化表达。',
    'tech-writing': '5. 采用技术写作风格：主动语态、动词开头、简洁精确，参考 Microsoft / Google API 文档。',
    concise: '5. 极致精简：删除冗余修饰，优先短句，每条注释一行表达一个要点。',
    friendly: '5. 语气亲切易懂，适合面向初学者，但保持专业术语准确。',
  };

  return `${base}\n${styleNote[style]}\n\n请直接输出译文：`;
}

export function languageName(code: string): string {
  const map: Record<string, string> = {
    zh: '简体中文', 'zh-cn': '简体中文', 'zh-hans': '简体中文',
    'zh-tw': '繁体中文', 'zh-hant': '繁体中文',
    ja: '日语', ko: '韩语',
    en: '英语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语',
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
}
