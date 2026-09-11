import { ITranslator } from './translator';
import { TranslationCache } from './translation-cache';

/**
 * CachedTranslator
 * ─────────────────────────────────────────────────────────────────
 * 装饰器（Decorator）：包装任意一个 ITranslator，在调用真实翻译前先查缓存，
 * 命中则直接返回，未命中才请求远端；翻译结果写回缓存。
 *
 * 断点续跑原理：
 *   - 每个「原文 + 源语言 + 目标语言 + 引擎」组合以 SHA-1 前 12 位作 key
 *   - 缓存持久化到 .comment-translator-cache/<backend>-<src>-<tgt>.jsonl
 *   - 进程启动时自动加载该文件到内存 → 中断后重跑同一命令即命中旧缓存
 *   - 写文件采用「追加 + 防抖」策略，兼顾性能与崩溃安全
 *
 * 用法：
 *   const translator = createTranslator({ ... });
 *   const cached = new CachedTranslator(translator, {
 *     cacheDir: '.comment-translator-cache',
 *     sourceLang: 'auto',
 *     targetLang: 'zh',
 *     backend: 'deepl',
 *   });
 *   await cached.translateBatch(texts);  // 自动走缓存
 *   // ... 进程任意时刻中断，重启后从上次进度继续 ...
 */
export interface CachedTranslatorOptions {
  /** 缓存目录（默认 .comment-translator-cache） */
  cacheDir?: string;
  /** 引擎标识（deepl / google / libretranslate ...） */
  backend: string;
  /** 源语言（默认 auto = 自动检测） */
  sourceLang?: string;
  /** 目标语言 */
  targetLang: string;
  /** 是否禁用缓存（true 时退化为直连，方便对比/强制刷新） */
  disabled?: boolean;
  /** 命中时是否打印日志（verbose） */
  verbose?: boolean;
}

export class CachedTranslator implements ITranslator {
  private cache: TranslationCache;
  private disabled: boolean;
  private verbose: boolean;
  private stats = { hits: 0, misses: 0 };

  constructor(
    private readonly inner: ITranslator,
    options: CachedTranslatorOptions,
  ) {
    this.disabled = options.disabled ?? false;
    this.verbose = options.verbose ?? false;
    this.cache = new TranslationCache({
      cacheDir: options.cacheDir,
      backend: options.backend,
      sourceLang: options.sourceLang || 'auto',
      targetLang: options.targetLang,
    });
  }

  /**
   * 单条翻译（带缓存）
   */
  async translate(text: string, target?: string): Promise<string> {
    if (!text.trim()) return text;
    if (this.disabled) return this.inner.translate(text, target);

    const cached = this.cache.get(text);
    if (cached !== null) {
      this.stats.hits++;
      return cached;
    }

    this.stats.misses++;
    const result = await this.inner.translate(text, target);
    this.cache.set(text, result);
    return result;
  }

  /**
   * 批量翻译（带缓存 + 断点续跑核心逻辑）
   *
   * 流程：
   *   1. 查缓存 → 命中的直接取译文
   *   2. 未命中的收集成 missTexts
   *   3. 仅对 missTexts 调用真实批量翻译（去重后再请求，减少 API 调用）
   *   4. 把新译文写回缓存
   *   5. 按原始顺序组装返回结果
   *
   * 中断恢复：若上一次跑到第 N 条时崩溃，已翻译的 N 条都已落盘；
   *           重跑时这批全部命中缓存，只需翻译剩余部分。
   */
  async translateBatch(texts: string[], target?: string): Promise<string[]> {
    if (this.disabled) {
      return this.inner.translateBatch(texts, target);
    }

    const result: string[] = new Array(texts.length);
    const missIndices: number[] = [];
    const missTexts: string[] = [];

    // 1 & 2：逐条查缓存，分离命中 / 未命中
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text.trim()) {
        result[i] = text;
        continue;
      }

      const cached = this.cache.get(text);
      if (cached !== null) {
        result[i] = cached;
        this.stats.hits++;
      } else {
        result[i] = ''; // placeholder
        missIndices.push(i);
        missTexts.push(text);
      }
    }

    // 3：仅翻译未命中的部分（去重，进一步省 API 配额）
    if (missTexts.length > 0) {
      if (this.verbose) {
        console.log(
          `[Cache] ${this.stats.hits} hit, ${missTexts.length} miss → requesting API...`
        );
      }

      // 去重：保留首次出现顺序
      const seen = new Set<string>();
      const uniqTexts: string[] = [];
      for (const t of missTexts) {
        if (!seen.has(t)) {
          seen.add(t);
          uniqTexts.push(t);
        }
      }

      const uniqResults = await this.inner.translateBatch(uniqTexts, target);

      // 建立 原文→译文 映射
      const translatedMap = new Map<string, string>();
      for (let k = 0; k < uniqTexts.length; k++) {
        translatedMap.set(uniqTexts[k], uniqResults[k]);
        // 4：写缓存（每条原文 + 译文）
        this.cache.set(uniqTexts[k], uniqResults[k]);
      }

      // 5：回填到原始位置（含去重后的重复项）
      for (const idx of missIndices) {
        result[idx] = translatedMap.get(texts[idx]) ?? texts[idx];
      }

      this.stats.misses += missTexts.length;
    }

    return result;
  }

  /**
   * 强制刷新：清空当前语言对的缓存文件
   */
  clearCache(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  /**
   * 确保缓存落盘（在进程退出前调用，避免丢失未刷盘的条目）
   */
  flush(): void {
    this.cache.flushSync();
  }

  /**
   * 打印缓存命中统计
   */
  printStats(): void {
    const total = this.stats.hits + this.stats.misses;
    const ratio = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
    console.log(
      `\n[Cache] hits=${this.stats.hits}, misses=${this.stats.misses}, ` +
        `hit-rate=${ratio}% (saved ${this.stats.hits} API calls)`
    );
  }

  /** 透传底层 translator（高级用法） */
  getInner(): ITranslator {
    return this.inner;
  }
}
