import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 单条缓存记录
 */
export interface CacheEntry {
  /** 原文哈希 */
  hash: string;
  /** 源语言 */
  sourceLang: string;
  /** 目标语言 */
  targetLang: string;
  /** 翻译引擎 */
  backend: string;
  /** 翻译结果 */
  translated: string;
  /** 创建时间戳 */
  createdAt: number;
}

/**
 * 翻译缓存管理器
 * - 内存 Map 提供 O(1) 查询
 * - JSONL 文件持久化，每行一个 JSON 对象，追加写入
 * - 启动时加载到内存，支持断点续跑
 */
export class TranslationCache {
  private readonly cacheDir: string;
  private readonly cacheFile: string;
  private readonly memory = new Map<string, CacheEntry>();
  private readonly backend: string;
  private readonly targetLang: string;
  private readonly sourceLang: string;
  private writeBuffer: string[] = [];
  private flushScheduled = false;

  constructor(options: {
    cacheDir?: string;
    backend: string;
    sourceLang: string;
    targetLang: string;
  }) {
    this.backend = options.backend;
    this.sourceLang = options.sourceLang || 'auto';
    this.targetLang = options.targetLang;

    // 缓存目录：默认 .comment-translator-cache
    this.cacheDir = options.cacheDir || path.resolve(process.cwd(), '.comment-translator-cache');
    this.ensureDir();

    // 缓存文件名包含语言对和引擎，避免混淆
    const safeBackend = this.backend.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    this.cacheFile = path.join(this.cacheDir, `${safeBackend}-${this.sourceLang}-${this.targetLang}.jsonl`);

    this.loadFromFile();
  }

  /**
   * 生成缓存 Key：hash + 语言对 + 引擎
   */
  private static makeKey(text: string, sourceLang: string, targetLang: string, backend: string): string {
    const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
    return `${backend}:${sourceLang}:${targetLang}:${hash}`;
  }

  /**
   * 启动时从 JSONL 文件加载所有缓存到内存
   */
  private loadFromFile(): void {
    if (!fs.existsSync(this.cacheFile)) {
      return;
    }
    try {
      const content = fs.readFileSync(this.cacheFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry: CacheEntry = JSON.parse(line);
          const key = `${entry.backend}:${entry.sourceLang}:${entry.targetLang}:${entry.hash}`;
          this.memory.set(key, entry);
        } catch {
          // 忽略损坏行
        }
      }
      console.log(`[Cache] 已加载 ${this.memory.size} 条缓存记录: ${path.basename(this.cacheFile)}`);
    } catch (err) {
      console.warn(`[Cache] 加载缓存文件失败: ${(err as Error).message}`);
    }
  }

  /**
   * 查询缓存
   * @returns 命中则返回翻译结果，否则返回 null
   */
  get(text: string): string | null {
    const key = TranslationCache.makeKey(text, this.sourceLang, this.targetLang, this.backend);
    const entry = this.memory.get(key);
    if (entry) {
      return entry.translated;
    }
    return null;
  }

  /**
   * 批量查询，返回 Map<原文, 译文>，未命中的不在 Map 中
   */
  getBatch(texts: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const text of texts) {
      const translated = this.get(text);
      if (translated !== null) {
        result.set(text, translated);
      }
    }
    return result;
  }

  /**
   * 写入单条缓存（异步批量落盘）
   */
  set(text: string, translated: string): void {
    const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
    const key = `${this.backend}:${this.sourceLang}:${this.targetLang}:${hash}`;
    const entry: CacheEntry = {
      hash,
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      backend: this.backend,
      translated,
      createdAt: Date.now(),
    };
    this.memory.set(key, entry);
    this.writeBuffer.push(JSON.stringify(entry));
    this.scheduleFlush();
  }

  /**
   * 批量写入
   */
  setBatch(pairs: Array<{ original: string; translated: string }>): void {
    for (const { original, translated } of pairs) {
      this.set(original, translated);
    }
  }

  /**
   * 调度异步落盘（防抖，避免频繁写文件）
   */
  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      this.ensureDir();
      this.flushSync();
    });
  }

  /**
   * 同步刷盘（在进程退出前调用，确保不丢缓存）
   */
  flushSync(): void {
    if (this.writeBuffer.length === 0) {
      return;
    }
    try {
      this.ensureDir();
      const data = this.writeBuffer.join('\n') + '\n';
      fs.appendFileSync(this.cacheFile, data, 'utf-8');
      this.writeBuffer = [];
    } catch (err) {
      console.warn(`[Cache] 写入缓存失败: ${(err as Error).message}`);
    }
  }

  /** 确保缓存目录存在（供 scheduleFlush / flushSync 调用） */
  private ensureDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 统计信息
   */
  stats(): { total: number; backend: string; targetLang: string; cacheFile: string } {
    return {
      total: this.memory.size,
      backend: this.backend,
      targetLang: this.targetLang,
      cacheFile: this.cacheFile,
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.memory.clear();
    this.writeBuffer = [];
    if (fs.existsSync(this.cacheFile)) {
      fs.unlinkSync(this.cacheFile);
    }
  }
}
