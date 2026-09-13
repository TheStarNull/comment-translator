/**
 * Mock translator — an offline, deterministic stand-in for a real backend.
 *
 * Used for `--mock` runs, the test-suite, and demos. It never touches the
 * network, so it is safe in CI and fully reproducible.
 *
 * Design goals
 * ------------
 * 1. **Offline & deterministic** — same input always yields the same output, so
 *    tests and cache-hit assertions are stable.
 * 2. **Structure-preserving** — the mock must be a faithful stand-in for a real
 *    engine, otherwise pipeline tests prove nothing. It therefore:
 *      · keeps JSDoc tags, `{Type}` annotations, parameter names and the `-`
 *        separator intact (only the description is "translated");
 *      · leaves `@example` / fenced code blocks completely untouched;
 *      · never rewrites code identifiers (`BlockPermutation`, `MAX_RETRY`,
 *        `foo_bar`, `v2`), `{@link ...}` inline tags, `` `code spans` `` or URLs.
 * 3. **Cheap** — every dictionary is compiled into ONE regex, once per language,
 *    and cached. (The previous implementation recompiled one regex per word on
 *    every single call — ~40 compilations each time.)
 * 4. **Obviously fake** — each translated line is prefixed with a marker (default
 *    `[<lang>] `) so mock output can never be mistaken for a real translation.
 */

import { ITranslator } from './translator';

export interface MockTranslatorOptions {
  targetLanguage: string;
  sourceLanguage?: string;
  /**
   * Prefix marking each translated line. Defaults to `[<lang>] `.
   * Set to `''` to disable marking (not recommended — see goal 4).
   */
  marker?: string;
}

/* ------------------------------------------------------------------ */
/*  Dictionaries                                                       */
/* ------------------------------------------------------------------ */

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<string, Dictionary> = {
  zh: {
    hello: '你好', world: '世界', function: '函数', returns: '返回', return: '返回',
    description: '描述', param: '参数', parameter: '参数', example: '示例', author: '作者',
    the: '这', a: '一个', an: '一个', is: '是', are: '是', was: '曾是', were: '曾是',
    this: '这个', that: '那个', and: '和', or: '或', but: '但', if: '如果', then: '那么',
    gets: '获取', get: '获取', sets: '设置', set: '设置', creates: '创建', create: '创建',
    removes: '移除', remove: '移除', adds: '添加', add: '添加', updates: '更新',
    value: '值', data: '数据', object: '对象', array: '数组', map: '映射',
    string: '字符串', number: '数字', boolean: '布尔', options: '选项', option: '选项',
    config: '配置', configuration: '配置', default: '默认', optional: '可选',
    required: '必需', true: '真', false: '假', if_true: '真',
    calculates: '计算', calculate: '计算', total: '总计', sum: '求和', average: '平均值',
    represents: '表示', user: '用户', users: '用户', name: '名称', id: '标识',
    size: '尺寸', block: '块', blocks: '块', permutation: '置换', state: '状态',
    clock: '时钟', time: '时间', world_clock: '世界时钟', error: '错误',
    throws: '抛出', when: '当', before: '之前', after: '之后', during: '期间',
    used: '用于', use: '使用', using: '使用', with: '用', without: '不用',
    from: '从', to: '到', into: '到', for: '用于', of: '的', in: '在', on: '在',
    not: '不', all: '所有', any: '任意', some: '某些', each: '每个', every: '每个',
    first: '第一', last: '最后', next: '下一个', previous: '上一个',
    new: '新的', old: '旧的', current: '当前', given: '给定的', specified: '指定的',
    returns_a: '返回一个', valid: '有效', invalid: '无效', empty: '空', null: '空',
    undefined: '未定义', enabled: '启用', disabled: '禁用', true_if: '当为真',
    callback: '回调', handler: '处理器', listener: '监听器', event: '事件',
    error_message: '错误消息', message: '消息', log: '日志', debug: '调试',
    method: '方法', property: '属性', class: '类', interface: '接口', type: '类型',
    module: '模块', package: '包', file: '文件', path: '路径', directory: '目录',
    number_of: '数量', list: '列表', items: '项', item: '项', element: '元素',
    contains: '包含', checks: '检查', check: '检查', verifies: '验证',
    initializes: '初始化', register: '注册', unregister: '注销',
    throws_an_error: '抛出错误', throws_if: '抛出', otherwise: '否则',
    otherwise_returns: '否则返回', called: '调用', calls: '调用',
  },
  ja: {
    hello: 'こんにちは', world: '世界', function: '関数', returns: '返す', return: '返す',
    description: '説明', param: 'パラメータ', example: '例', author: '著者',
    the: 'その', a: 'ひとつ', an: 'ひとつ', is: 'です', are: 'です',
    this: 'これ', that: 'それ', and: 'と', or: 'または', but: 'しかし',
    gets: '取得', get: '取得', sets: '設定', set: '設定', creates: '作成',
    removes: '削除', value: '値', data: 'データ', object: 'オブジェクト',
    array: '配列', options: 'オプション', config: '設定', default: 'デフォルト',
    optional: 'オプション', required: '必須', represents: '表す', user: 'ユーザー',
    name: '名前', id: 'ID', size: 'サイズ', block: 'ブロック', state: '状態',
    time: '時間', error: 'エラー', throws: 'スロー', when: 'とき', used: '使用',
    from: 'から', to: 'へ', for: 'のため', of: 'の', in: 'で', on: 'で',
    not: 'ない', all: 'すべて', first: '最初', last: '最後', new: '新しい',
    method: 'メソッド', property: 'プロパティ', class: 'クラス', type: '型',
    file: 'ファイル', path: 'パス', list: 'リスト', item: '項目', contains: '含む',
  },
  ko: {
    hello: '안녕하세요', world: '세계', function: '함수', returns: '반환', return: '반환',
    description: '설명', param: '매개변수', example: '예시', author: '작성자',
    the: '그', is: '입니다', are: '입니다', this: '이것', that: '저것',
    and: '그리고', or: '또는', gets: '가져옵니다', sets: '설정합니다', creates: '생성합니다',
    removes: '제거합니다', value: '값', data: '데이터', object: '객체', array: '배열',
    options: '옵션', config: '설정', default: '기본값', optional: '선택 사항',
    required: '필수', represents: '나타냅니다', user: '사용자', name: '이름', id: '식별자',
    size: '크기', block: '블록', state: '상태', time: '시간', error: '오류',
    throws: '던집니다', when: '때', used: '사용됨', from: '부터', to: '까지',
    for: '위해', of: '의', in: '에서', not: '아님', all: '모두', new: '새로운',
    method: '메서드', property: '속성', class: '클래스', type: '타입', file: '파일',
    path: '경로', list: '목록', item: '항목',
  },
  es: {
    hello: 'hola', world: 'mundo', function: 'función', returns: 'devuelve', return: 'devuelve',
    description: 'descripción', param: 'parámetro', example: 'ejemplo', author: 'autor',
    the: 'el', a: 'un', an: 'un', is: 'es', are: 'son', this: 'este', that: 'ese',
    and: 'y', or: 'o', but: 'pero', gets: 'obtiene', set: 'establece', sets: 'establece',
    creates: 'crea', removes: 'elimina', value: 'valor', data: 'datos',
    object: 'objeto', array: 'arreglo', options: 'opciones', config: 'configuración',
    default: 'predeterminado', optional: 'opcional', required: 'requerido',
    represents: 'representa', user: 'usuario', name: 'nombre', id: 'identificador',
    size: 'tamaño', block: 'bloque', state: 'estado', time: 'tiempo', error: 'error',
    throws: 'lanza', when: 'cuando', used: 'usado', from: 'desde', to: 'hasta',
    for: 'para', of: 'de', in: 'en', not: 'no', all: 'todos', first: 'primero',
    last: 'último', new: 'nuevo', method: 'método', property: 'propiedad',
    class: 'clase', type: 'tipo', file: 'archivo', path: 'ruta', list: 'lista',
    item: 'elemento', contains: 'contiene',
  },
  fr: {
    hello: 'bonjour', world: 'monde', function: 'fonction', returns: 'retourne',
    return: 'retourne', description: 'description', param: 'paramètre',
    example: 'exemple', author: 'auteur', the: 'le', a: 'un', an: 'un', is: 'est',
    are: 'sont', this: 'ce', that: 'cela', and: 'et', or: 'ou', but: 'mais',
    gets: 'obtient', sets: 'définit', set: 'définit', creates: 'crée',
    removes: 'supprime', value: 'valeur', data: 'données', object: 'objet',
    array: 'tableau', options: 'options', config: 'configuration',
    default: 'par défaut', optional: 'facultatif', required: 'requis',
    represents: 'représente', user: 'utilisateur', name: 'nom', id: 'identifiant',
    size: 'taille', block: 'bloc', state: 'état', time: 'temps', error: 'erreur',
    throws: 'lève', when: 'lorsque', used: 'utilisé', from: 'depuis', to: 'à',
    for: 'pour', of: 'de', in: 'dans', not: 'ne pas', all: 'tous',
    first: 'premier', last: 'dernier', new: 'nouveau', method: 'méthode',
    property: 'propriété', class: 'classe', type: 'type', file: 'fichier',
    path: 'chemin', list: 'liste', item: 'élément', contains: 'contient',
  },
  de: {
    hello: 'hallo', world: 'Welt', function: 'Funktion', returns: 'gibt zurück',
    return: 'gibt zurück', description: 'Beschreibung', param: 'Parameter',
    example: 'Beispiel', author: 'Autor', the: 'der', a: 'ein', an: 'ein',
    is: 'ist', are: 'sind', this: 'dies', that: 'das', and: 'und', or: 'oder',
    but: 'aber', gets: 'ruft ab', sets: 'setzt', set: 'setzt', creates: 'erstellt',
    removes: 'entfernt', value: 'Wert', data: 'Daten', object: 'Objekt',
    array: 'Array', options: 'Optionen', config: 'Konfiguration',
    default: 'Standard', optional: 'optional', required: 'erforderlich',
    represents: 'repräsentiert', user: 'Benutzer', name: 'Name', id: 'ID',
    size: 'Größe', block: 'Block', state: 'Zustand', time: 'Zeit', error: 'Fehler',
    throws: 'wirft', when: 'wenn', used: 'verwendet', from: 'von', to: 'bis',
    for: 'für', of: 'von', in: 'in', not: 'nicht', all: 'alle',
    first: 'erste', last: 'letzte', new: 'neu', method: 'Methode',
    property: 'Eigenschaft', class: 'Klasse', type: 'Typ', file: 'Datei',
    path: 'Pfad', list: 'Liste', item: 'Element', contains: 'enthält',
  },
  pt: {
    hello: 'olá', world: 'mundo', function: 'função', returns: 'retorna',
    return: 'retorna', description: 'descrição', param: 'parâmetro',
    example: 'exemplo', author: 'autor', the: 'o', a: 'um', an: 'um', is: 'é',
    are: 'são', this: 'este', that: 'esse', and: 'e', or: 'ou', but: 'mas',
    gets: 'obtém', sets: 'define', set: 'define', creates: 'cria',
    removes: 'remove', value: 'valor', data: 'dados', object: 'objeto',
    array: 'array', options: 'opções', config: 'configuração',
    default: 'padrão', optional: 'opcional', required: 'obrigatório',
    represents: 'representa', user: 'usuário', name: 'nome', id: 'identificador',
    size: 'tamanho', block: 'bloco', state: 'estado', time: 'tempo', error: 'erro',
    throws: 'lança', when: 'quando', used: 'usado', from: 'de', to: 'para',
    for: 'para', of: 'de', in: 'em', not: 'não', all: 'todos',
    first: 'primeiro', last: 'último', new: 'novo', method: 'método',
    property: 'propriedade', class: 'classe', type: 'tipo', file: 'arquivo',
    path: 'caminho', list: 'lista', item: 'item', contains: 'contém',
  },
  ru: {
    hello: 'привет', world: 'мир', function: 'функция', returns: 'возвращает',
    return: 'возвращает', description: 'описание', param: 'параметр',
    example: 'пример', author: 'автор', the: '', a: '', an: '', is: 'является',
    are: 'являются', this: 'это', that: 'то', and: 'и', or: 'или', but: 'но',
    gets: 'получает', sets: 'устанавливает', set: 'устанавливает',
    creates: 'создаёт', removes: 'удаляет', value: 'значение', data: 'данные',
    object: 'объект', array: 'массив', options: 'параметры', config: 'конфигурация',
    default: 'по умолчанию', optional: 'необязательный', required: 'обязательный',
    represents: 'представляет', user: 'пользователь', name: 'имя', id: 'идентификатор',
    size: 'размер', block: 'блок', state: 'состояние', time: 'время', error: 'ошибка',
    throws: 'выбрасывает', when: 'когда', used: 'используется', from: 'из', to: 'в',
    for: 'для', of: 'из', in: 'в', not: 'не', all: 'все', first: 'первый',
    last: 'последний', new: 'новый', method: 'метод', property: 'свойство',
    class: 'класс', type: 'тип', file: 'файл', path: 'путь', list: 'список',
    item: 'элемент', contains: 'содержит',
  },
};

/** Accepted aliases → canonical dictionary key. */
const LANGUAGE_ALIASES: Record<string, string> = {
  'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', zh_cn: 'zh',
  'pt-br': 'pt', pt_br: 'pt', 'es-419': 'es', 'en-us': 'en', 'de-de': 'de',
  'fr-fr': 'fr', 'ja-jp': 'ja', 'ko-kr': 'ko', 'ru-ru': 'ru',
};

/* ------------------------------------------------------------------ */
/*  Compilation (once per language, cached)                            */
/* ------------------------------------------------------------------ */

interface CompiledDictionary {
  /** Matches any known source word, longest first, case-insensitively. */
  regex: RegExp;
  /** lower-cased source word → translation. */
  lookup: Map<string, string>;
}

const compiledCache = new Map<string, CompiledDictionary | null>();

/** Canonical form of a language tag: `ZH-CN` / `zh_CN` → `zh`. */
export function normalizeLanguage(lang: string): string {
  const lower = (lang || '').trim().toLowerCase();
  if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
  return lower.split(/[-_]/)[0] || 'en';
}

function compileDictionary(canonical: string): CompiledDictionary | null {
  const dict = DICTIONARIES[canonical];
  if (!dict) return null;

  // Escape every key and sort longest-first so e.g. `parameter` wins over `param`.
  const keys = Object.keys(dict).filter(k => k.length > 0).sort((a, b) => b.length - a.length);
  const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  return {
    regex: new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi'),
    lookup: new Map(keys.map(k => [k, dict[k]])),
  };
}

function getDictionary(canonical: string): CompiledDictionary | null {
  if (!compiledCache.has(canonical)) {
    compiledCache.set(canonical, compileDictionary(canonical));
  }
  return compiledCache.get(canonical) ?? null;
}

/* ------------------------------------------------------------------ */
/*  Span protection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Regions that must never be translated, mirroring what the real pipeline's
 * TermProtector keeps intact:
 *   · `{@link Foo}` inline tags and `{Type}` annotations
 *   · `` `code spans` ``
 *   · URLs
 */
const PROTECTED_SPAN = /`[^`]*`|\{[^{}]*\}|https?:\/\/[^\s<>()[\]{}]+/g;

/**
 * True for tokens that look like code rather than prose — `BlockPermutation`,
 * `MAX_RETRY`, `foo_bar`, `v2`. A real translator leaves these alone; so does
 * the mock, which keeps its output structurally faithful.
 */
function isIdentifierLike(word: string): boolean {
  if (word.length < 2) return false;
  if (word.includes('_')) return true; // snake_case / UPPER_CASE
  if (/\d/.test(word)) return true; // v2, utf8, iso8601
  if (/[a-z][A-Z]/.test(word)) return true; // camelCase
  return false; // `Hello` is prose, not an identifier
}

/** Copy the source word's capitalisation onto a cased translation. */
function matchCase(source: string, translated: string): string {
  if (!translated) return translated;
  const hasCase = translated.toLowerCase() !== translated.toUpperCase();
  if (!hasCase) return translated; // CJK / uncased scripts
  const first = source[0];
  const sourceIsUpper = first === first.toUpperCase() && first !== first.toLowerCase();
  if (!sourceIsUpper) return translated;
  return translated[0].toUpperCase() + translated.slice(1);
}

/** Pseudo-localisation used when the target has no dictionary (`en`, unknown). */
const PSEUDO_MAP: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú',
};

/* ------------------------------------------------------------------ */
/*  Comment-shaped translation                                         */
/* ------------------------------------------------------------------ */

/** Tags whose body is code and must be left verbatim. */
const VERBATIM_TAGS = new Set(['example', 'code', 'codeblock', 'pre']);

/** Tags that name a symbol after the (optional) type. */
const NAMED_TAGS = new Set([
  'param', 'parameter', 'arg', 'argument', 'property', 'prop',
  'template', 'typeparam', 'typedef', 'name', 'member', 'var', 'field',
]);

export class MockTranslator implements ITranslator {
  private readonly targetLanguage: string;
  /** Explicit `marker` option; when unset the marker tracks the active language. */
  private readonly markerOverride?: string;
  /** Counts translate calls — used to verify cache hit/miss behaviour. */
  public callCount = 0;

  constructor(config: MockTranslatorOptions) {
    this.targetLanguage = config.targetLanguage;
    this.markerOverride = config.marker;
  }

  /**
   * Marker for a given language. Derived per call so that an explicit `target`
   * argument (e.g. `translate(text, 'ja')`) is reflected in the output.
   */
  private markerFor(lang: string): string {
    return this.markerOverride ?? `[${lang}] `;
  }

  /** Reset the call counter (used by tests). */
  reset(): void {
    this.callCount = 0;
  }

  async translate(text: string, target?: string): Promise<string> {
    this.callCount++;
    return this.mockTranslate(text, target);
  }

  async translateBatch(texts: string[], target?: string): Promise<string[]> {
    this.callCount += texts.length;
    return texts.map(t => this.mockTranslate(t, target));
  }

  /* ---------------------------------------------------------------- */

  private mockTranslate(text: string, target?: string): string {
    if (!text) return text;
    const lang = normalizeLanguage(target ?? this.targetLanguage);
    return this.translateCommentBlock(text, lang);
  }

  /**
   * Translate a whole comment body, preserving its line structure.
   *
   * Each line is split into a decorative prefix (indent + optional leading `*`)
   * and the content. Tag lines keep their `@tag`, `{Type}`, symbol name and `-`
   * separator; only the trailing description is translated.
   */
  private translateCommentBlock(text: string, lang: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let inVerbatimTag = false;

    for (const line of lines) {
      if (line.trim() === '') {
        out.push(line);
        continue;
      }

      // ` * content` / `\tcontent` / `content`
      const m = line.match(/^(\s*(?:\*\s?)?)([\s\S]*)$/);
      const prefix = m?.[1] ?? '';
      const content = m?.[2] ?? line;

      const tagMatch = content.match(/^@([A-Za-z][\w-]*)([\s\S]*)$/);

      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        inVerbatimTag = VERBATIM_TAGS.has(tag);
        if (inVerbatimTag) {
          out.push(line); // keep `@example` and its body verbatim
          continue;
        }
        const rendered = this.translateTagLine(tag, tagMatch[2], lang);
        out.push(rendered === null ? line : prefix + this.markerFor(lang) + rendered);
        continue;
      }

      if (inVerbatimTag) {
        out.push(line); // continuation of an `@example` body
        continue;
      }

      const translated = this.translateProse(content, lang);
      out.push(translated === null ? line : prefix + this.markerFor(lang) + translated);
    }

    return out.join('\n');
  }

  /**
   * Rebuild a tag line, translating only the description.
   * @returns the rendered line, or `null` when there is nothing to translate.
   */
  private translateTagLine(tag: string, rest: string, lang: string): string | null {
    let head = '@' + tag;
    let tail = rest;

    // `{Type}` annotation
    const typeMatch = tail.match(/^\s*(\{[^{}]*\})/);
    if (typeMatch) {
      head += ' ' + typeMatch[1];
      tail = tail.slice(typeMatch[0].length);
    }

    // Symbol name (only meaningful for param-like tags)
    if (NAMED_TAGS.has(tag)) {
      const nameMatch = tail.match(/^\s+([A-Za-z_$][\w$]*)/);
      if (nameMatch) {
        head += ' ' + nameMatch[1];
        tail = tail.slice(nameMatch[0].length);
      }
    }

    // `-` / `:` separator
    const sepMatch = tail.match(/^\s*([-:])\s*/);
    if (sepMatch) {
      head += ' ' + sepMatch[1] + ' ';
      tail = tail.slice(sepMatch[0].length);
    } else if (tail.trim()) {
      head += ' ';
    }

    const translated = this.translateProse(tail, lang);
    if (translated === null) return null;
    return (head + translated).trimEnd();
  }

  /**
   * Translate the prose in `text`, leaving protected spans and identifiers alone.
   * @returns the translation, or `null` when nothing needed translating.
   */
  private translateProse(text: string, lang: string): string | null {
    if (!text.trim()) return null;
    const dict = getDictionary(lang);

    // Split into protected and translatable runs, keeping the delimiters.
    let result = '';
    let last = 0;
    PROTECTED_SPAN.lastIndex = 0;
    let span: RegExpExecArray | null;

    const translateRun = (run: string): string => this.translateRun(run, dict);

    while ((span = PROTECTED_SPAN.exec(text)) !== null) {
      result += translateRun(text.slice(last, span.index));
      result += span[0]; // protected verbatim
      last = span.index + span[0].length;
    }
    result += translateRun(text.slice(last));

    return result;
  }

  /** Translate a run with no protected spans. */
  private translateRun(run: string, dict: CompiledDictionary | null): string {
    if (!run) return run;

    if (!dict) {
      // No dictionary for this language (`en`, or an unknown code) →
      // pseudo-localise, so the output is visibly not the original text.
      return run.replace(/[aeiouAEIOU]/g, c => PSEUDO_MAP[c] ?? c);
    }

    return run.replace(dict.regex, word => {
      if (isIdentifierLike(word)) return word; // leave code as-is
      const translation = dict.lookup.get(word.toLowerCase());
      if (translation === undefined || translation === '') return word;
      return matchCase(word, translation);
    });
  }
}
