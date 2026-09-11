/**
 * Mock translator for testing and demonstration purposes.
 * Simulates a translation API without making actual network calls.
 * Implements ITranslator so it can be dropped into the engine directly.
 *
 * For real translation, replace with DeepLTranslator (see ./translator).
 */

import { ITranslator } from './translator';

export class MockTranslator implements ITranslator {
  private targetLanguage: string;
  private sourceLanguage?: string;
  /** Counts real translate calls — useful for verifying cache hit/miss. */
  public callCount = 0;

  constructor(config: { targetLanguage: string; sourceLanguage?: string }) {
    this.targetLanguage = config.targetLanguage;
    this.sourceLanguage = config.sourceLanguage;
  }

  /** Reset the call counter (used by tests). */
  reset(): void {
    this.callCount = 0;
  }

  /** ITranslator-compatible single translate (target is optional, mock ignores it). */
  async translate(text: string, _target?: string): Promise<string> {
    this.callCount++;
    return this.mockTranslate(text);
  }

  /** Backward-compatible alias. */
  async translateText(text: string): Promise<string> {
    return this.mockTranslate(text);
  }

  async translateBatch(texts: string[], _target?: string): Promise<string[]> {
    this.callCount += texts.length;
    return texts.map(t => this.mockTranslate(t));
  }

  private mockTranslate(text: string): string {
    // Simple mock: add language prefix and some "translation" markers
    const lang = this.targetLanguage;
    const prefix = `[${lang}] `;

    // Handle multi-line JSDoc
    if (text.includes('\n')) {
      return text
        .split('\n')
        .map(line => {
          if (line.trim() === '') return line;
          // Preserve JSDoc tag structure
          const tagMatch = line.match(/^(\s*)?(@\w+)?\s*(.*)$/);
          if (tagMatch && tagMatch[2]) {
            // Has a JSDoc tag - translate only the description part
            const indent = tagMatch[1] || '';
            const tag = tagMatch[2];
            const desc = tagMatch[3];
            if (desc.trim()) {
              return `${indent}${tag} ${prefix}${this.translateWords(desc.trim())}`;
            }
            return line;
          }
          return `${prefix}${this.translateWords(line.trim())}`;
        })
        .join('\n');
    }

    return `${prefix}${this.translateWords(text)}`;
  }

  private translateWords(text: string): string {
    // Simple word substitution for common English words (mock translation)
    const dict: Record<string, Record<string, string>> = {
      'zh': {
        'hello': '你好', 'world': '世界', 'function': '函数', 'returns': '返回',
        'description': '描述', 'param': '参数', 'example': '示例', 'author': '作者',
        'the': '这', 'a': '一个', 'an': '一个', 'is': '是', 'are': '是',
        'this': '这个', 'that': '那个', 'and': '和', 'or': '或', 'but': '但',
        'gets': '获取', 'sets': '设置', 'creates': '创建', 'removes': '移除',
        'value': '值', 'data': '数据', 'object': '对象', 'array': '数组',
        'string': '字符串', 'number': '数字', 'boolean': '布尔', 'options': '选项',
        'config': '配置', 'default': '默认', 'optional': '可选', 'required': '必需',
        'calculates': '计算', 'total': '总计', 'sum': '求和', 'average': '平均值',
        'represents': '表示', 'user': '用户', 'name': '名称', 'id': '标识',
      },
      'ja': {
        'hello': 'こんにちは', 'world': '世界', 'function': '関数', 'returns': '返す',
        'description': '説明', 'param': 'パラメータ', 'example': '例', 'author': '著者',
        'the': 'その', 'a': 'ひとつ', 'is': 'です', 'this': 'これ',
        'gets': '取得', 'sets': '設定', 'creates': '作成',
      },
      'ko': {
        'hello': '안녕하세요', 'world': '세계', 'function': '함수', 'returns': '반환',
        'description': '설명', 'param': '매개변수', 'example': '예시',
      },
      'es': {
        'hello': 'hola', 'world': 'mundo', 'function': 'función', 'returns': 'retorna',
        'description': 'descripción', 'param': 'parámetro', 'example': 'ejemplo',
      },
    };

    const langDict = dict[this.targetLanguage] || dict['zh'];
    let result = text;

    // Replace whole words
    for (const [en, translated] of Object.entries(langDict)) {
      const regex = new RegExp(`\\b${en}\\b`, 'gi');
      result = result.replace(regex, translated);
    }

    // If no substitutions were made, just add prefix
    if (result === text) {
      return text; // Keep original if no translation available
    }

    return result;
  }
}
