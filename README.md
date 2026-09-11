# Comment Translator 🌐 (v2.4.1)

一个专门翻译 **JSDoc** 和代码注释的工具，支持 **JavaScript / TypeScript**（含 `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`, `.d.ts`），通过 **DeepL** / **Google Translate** / **LibreTranslate** 进行翻译，输出翻译后的文件。内置**翻译缓存（断点续跑）**，中断后重跑只翻剩余部分。

> 默认使用 **DeepL**（翻译质量更高，Free 版每月 50 万字符免费额度）；可通过 `--backend google` 或 `--backend libretranslate` 切换到 **Google**（覆盖 130+ 语言）或 **LibreTranslate**（可自托管，完全免费）。

---

## ✨ 功能特性

### 核心
- 🔍 **智能解析** — 精确提取 JSDoc、块注释、行注释
- 🏷️ **JSDoc 感知** — 识别 `@param` `@returns` `@example` `@beta` `@remarks` `@throws` `@privilege` 等标签，只翻译描述部分，保留类型与参数名
- 📦 **批量翻译** — 自动合并文本进行批量 API 调用，提高效率
- 📁 **目录递归** — 支持单文件或整个目录批量处理
- 🎯 **格式保持** — 翻译后保持原始缩进、星号前缀等格式
- ⚡ **自动重试** — 对限流（429）、配额（456）、5xx 错误自动退避重试

### 多后端
- 🌍 **DeepL**（默认，质量优先）— Free（`api-free.deepl.com`）／Pro（`api.deepl.com`）自动识别
- 🌍 **Google**（`--backend google`）— 覆盖 130+ 语言，BCP-47 语言码（zh-CN / zh-TW / ja ...）
- 🌍 **LibreTranslate**（`--backend libretranslate`）— 自托管 / 公共实例，无需 API Key

### 准确性保障
- 🛡️ **术语保护 (v2.3)** — 自动保护代码标识符（`camelCase`/`PascalCase`/`snake_case`/`UPPER_CASE`）、URL、反引号代码块、占位符（`%s`/`${name}`），并支持自定义术语表
- 🛡️ **JSDoc 内联标签保护 (v2.3.1)** — `{@link}` / `{@code}` / `{@linkcode}` / `{@linkplain}` / `{@inheritdoc}` 自动占位保护，翻译后无损还原
- 📐 **多行描述结构保留 (v2.3.1)** — `@remarks` / `@param` / `@throws` 等跨多行描述翻译后保留原始行数和缩进，不再压缩成单行

### 效率
- 💾 **翻译缓存 / 断点续跑 (v2.4.0)** — 以 `SHA-1(原文 + 后端 + 语言对)` 为 key 持久化，中断后重跑只翻剩余部分，节省 API 配额
- 🧪 **Mock 模式** — 内置模拟翻译器，无需 API Key 即可测试

---

## 📦 安装

```bash
cd comment-translator
npm install
npm run build    # 编译到 dist/（也可直接用包内预编译的 dist/）
```

依赖：`node-fetch`、`form-data`、`google-auth-library`。Node ≥ 16。

---

## 🚀 快速使用

### 方式一：DeepL（默认）

1. 注册 DeepL API Free：https://www.deepl.com/pro-api （Free key 通常以 `:fx` 结尾）
2. 配置 API Key：

```bash
export DEEPL_API_KEY="你的KEY:fx"
```

```bash
# 翻译单个文件 → 中文（简体）
node dist/cli.js ./src/index.ts --api-key YOUR_KEY:fx --target ZH

# 翻译整个目录 → 日文
node dist/cli.js ./src --target JA -o ./output

# 使用术语表保证术语一致
node dist/cli.js ./lib --api-key KEY --glossary abc123 --target ZH
```

端点自动选择：key 以 `:fx` 结尾 → Free；否则 → Pro。也可用 `--free` / `--pro` 强制指定。

### 方式二：Google Translate（`--backend google`）

1. 创建 API Key：https://console.cloud.google.com/apis/credentials （启用 **Cloud Translation API**）
2. 或使用服务账号 key.json（生产推荐）：

```bash
export GOOGLE_APPLICATION_CREDENTIALS="./google-key.json"
```

```bash
# 切换到 Google，目标语言用 BCP-47（zh-CN / zh-TW / ja ...）
node dist/cli.js ./src --backend google --target zh-CN -o ./out

# 使用 API Key 明文传参
node dist/cli.js ./src --backend google --api-key "$GOOGLE_API_KEY" --target ja

# 指定 nmt 模型 + 源语言
node dist/cli.js ./src --backend google --target zh-CN --source en --google-model nmt
```

> 💡 选择建议：**主要语言 + 翻译质量优先 → DeepL**；**小语种 / 多语言覆盖广 / 成本敏感 → Google**（Google 每百万字符约 $20，DeepL Pro 约 $25+固定费）。

### 方式三：LibreTranslate（`--backend libretranslate`）

完全免费、可自托管，无需 API Key（公共实例有速率限制）。

```bash
# 公共实例（无需 key）
node dist/cli.js ./src --backend libretranslate --libre-url https://libretranslate.example.com --target zh

# Docker 自托管（推荐）
docker run -d -p 5000:5000 libretranslate/libretranslate
node dist/cli.js ./src --backend libretranslate --libre-url http://localhost:5000 --target zh
```

语言码自动标准化：`ZH-CN → zh`、`JA → ja`。

### 方式四：Mock 模式（无需 API Key）

```bash
node dist/cli.js ./src --mock --target zh
```

---

## 💾 翻译缓存 / 断点续跑（v2.4.0，重点）

缓存默认关闭，**加 `--cache-dir` 即开启**。开启后：

- 已翻译的文本直接命中缓存，不再请求 API
- 进程中断（Ctrl+C / 网络失败 / 配额耗尽）后，**用完全相同的命令重跑，只翻译剩余未缓存部分**
- 缓存按 `后端 + 源语言 + 目标语言` 自动分文件，不同语言对互不干扰

```bash
# 首次运行：全量翻译，同时写入缓存
node dist/cli.js ./src --backend libretranslate --target zh --cache-dir .cache

# 中断后重跑：已翻译部分 0 次 API 调用，仅翻未命中部分
node dist/cli.js ./src --backend libretranslate --target zh --cache-dir .cache

# 强制忽略缓存，全部重翻
node dist/cli.js ./src --no-cache --target zh

# 清空缓存后从头翻译
node dist/cli.js ./src --clear-cache --target zh
```

缓存文件：`.cache/libretranslate-auto-zh.jsonl`（JSONL 追加写，进程结束自动 flush）。

**判断缓存是否生效**：日志中 `API calls: X → saved Y calls`，`Y > 0` 即表示命中。

> 若 `saved` 一直为 0，确认重跑时 `--backend` / `--target` / `--source-lang` 与首次完全一致——缓存 key 包含这三项。

---

## 📝 命令行参数

```
Arguments:
  <input>                        输入文件或目录

Options:
  -o, --output <path>            输出目录或文件路径
  -t, --target <lang>            目标语言代码 (默认: "ZH")
                                 DeepL: ZH/ZH-HANT/EN/JA/KO/DE/FR/ES/RU/PT-BR...
                                 Google/Libre: zh-CN/zh-TW/en/ja/ko/de/fr/es/...
  -s, --source <lang>            源语言代码 (可选, 默认自动检测)
  -b, --backend <name>           翻译后端: deepl | deepl-free | google | libretranslate | mock (默认: deepl)
  -k, --api-key <key>            API Key
  --free                         DeepL: 强制 Free 端点 (api-free.deepl.com)
  --pro                          DeepL: 强制 Pro 端点 (api.deepl.com)
  --formality <level>            DeepL 语气: default|prefer_less|prefer_more|less|more
  --glossary <id>               DeepL 术语表 ID
  --google-model <model>         Google 模型: base | nmt (默认: nmt)
  --google-credentials <path>    Google 服务账号 key.json 路径
  --libre-url <url>              LibreTranslate 服务地址 (默认: http://localhost:5000)
  --libre-key <key>              LibreTranslate API Key (公共实例可省略)
  --cache-dir <dir>              缓存目录, 指定即开启断点续跑
  --no-cache                     本次运行忽略已有缓存
  --clear-cache                  运行前清空缓存
  --mock                         使用模拟翻译器 (无需 API Key)
  --extensions <exts>            文件扩展名 (默认: ".js,.ts,.jsx,.tsx,.mjs,.cjs,.d.ts")
  --no-recursive                 禁用递归目录遍历
  --dry-run                      预览模式, 不写入文件
  -v, --verbose                  详细输出
  --progress                     显示进度条 (默认: 开, 除非 -v)
  --no-progress                  隐藏进度条
  --glossary-file <path>        术语表 JSON 文件路径
  --term <term...>              需保护的术语 (可重复, 如 --term DisplaySlotId --term scoreboard)
  --no-protect-identifiers      关闭自动保护代码标识符
  --no-protect-urls             不保护 URL
  --no-protect-code-spans       不保护 \`backtick\` 代码块
```

---

## 🛡️ 术语保护 (v2.3)

翻译 API 经常会把 **API 名、变量名、URL** 一起翻译或改写（例如把 `WorldClockReloadTimeMarkerError` 拆成多个词），导致译文里的代码引用失效。v2.3 引入术语保护，在翻译前把这些片段替换成占位符，翻译后再还原原文——对 DeepL / Google / LibreTranslate 完全透明。

### 保护对象

| 类别 | 示例 | 说明 |
|------|------|------|
| 代码标识符（默认开） | `onCreate`、`WorldClock`、`scoreboard`、`MAX_RETRY` | camelCase / PascalCase / snake_case / UPPER_CASE |
| URL（默认开） | `https://example.com` | 完整保留 |
| 反引号代码（默认开） | `` `registerClock()` `` | 完整保留 |
| 占位符（默认开） | `%s`、`${name}`、`{0}` | printf / 模板字符串 |
| JSDoc 内联标签（默认开） | `{@link LocationInUnloadedChunkError}` | 自动占位，无损还原 |
| 自定义术语 | `DisplaySlotId`、`scoreboard` | 来自 `--term` 或术语表文件 |

### 用法

```bash
# 1) 内联术语（快速）
node dist/cli.js ./src --mock --term DisplaySlotId --term WorldClock

# 2) 术语表文件（推荐，可维护、可入库）
node dist/cli.js ./src --mock --glossary-file ./glossary.json

# 3) 关闭自动标识符保护（仅保护术语表内容）
node dist/cli.js ./src --mock --glossary-file ./glossary.json --no-protect-identifiers
```

### 术语表格式 (`glossary.json`)

```json
{
  "terms": ["DisplaySlotId", "WorldClockReloadTimeMarkerError", "scoreboard"],
  "identifiers": true,
  "urls": true,
  "codeSpans": true,
  "placeholders": true
}
```

- `terms`：要保护的术语数组；也可写成对象 `{ "term": "译文提示" }`（对象形式的译文提示为未来「语义润色」预留，当前仅 key 用于保护）。
- `identifiers` / `urls` / `codeSpans` / `placeholders`：设为 `false` 可关闭对应自动保护。CLI 的 `--no-*` 优先级更高。
- 文件缺失或非合法 JSON 仅打印警告，**不会中断运行**。

### 效果示例

```
翻译前: Error thrown when registering a WorldClock with an invalid marker.
翻译后: 注册 WorldClock 时使用无效 marker 时抛出的错误。
        ↑ WorldClock 保持原文，其余正常翻译
```

运行结束后会在 Summary 中显示 `Terms protected: <count>`。详见 `src/term-protector.ts`。

---

## 📊 示例

### 翻译前 (TypeScript)

```typescript
/**
 * Represents a user in the system.
 * Handles authentication and profile management.
 *
 * @param name - The user's display name
 * @param email - The user's email address
 * @returns A new User object
 * @example
 * const user = new User("John", "john@example.com");
 */
class User {
  // TODO: Implement profile update
  private id: string;
}
```

### 翻译后 (中文)

```typescript
/**
 * 表示系统中的用户。
 * 处理身份验证和配置文件管理。
 *
 * @param name - 用户的显示名称
 * @param email - 用户的电子邮件地址
 * @returns 一个新的 User 对象
 * @example
 * const user = new User("John", "john@example.com");
 */
class User {
  // TODO: 实现配置文件更新
  private id: string;
}
```

### Minecraft Bedrock API（结构保留验证）

```typescript
/**
 * @remarks
 * 将尺寸中的块设置为
 * 置换的状态。
 * @privilege
 * no-restricted-execution - This function can't be called in restricted-execution mode.
 * @param
 * 排列
 * 包含该
 * 块的一组属性状态的排列。
 * @throws
 * 此函数可能会抛出错误。
 *
 * {@link LocationInUnloadedChunkError}
 * {@link LocationOutOfWorldBoundariesError}
 */
setPermutation(permutation: BlockPermutation): void;
```

翻译后：`@remarks`/`@param`/`@throws` 多行描述行数缩进完整保留，`@privilege` 原样，`{@link}` 内联标签无损，`BlockPermutation` 受术语保护——不会出现"翻译不完全"。

---

## 🏗️ 项目结构

```
comment-translator/
├── src/
│   ├── cli.ts                        # 命令行入口 (--backend 参数)
│   ├── translator.ts                 # ITranslator 接口 + 后端工厂 createTranslator()
│   ├── deepl-translator.ts           # DeepL 后端 (Free/Pro 自动识别)
│   ├── google-translator.ts          # Google Cloud Translation API 封装
│   ├── google-auth.ts                # Google 服务账号 JWT 签名 (纯 Node crypto)
│   ├── libretranslate-translator.ts  # 🌍 LibreTranslate 后端 (v2.4.0)
│   ├── mock-translator.ts            # 模拟翻译器 (测试用)
│   ├── parser.ts                     # 注释提取与还原
│   ├── jsdoc-parser.ts               # JSDoc 标签解析 (多行/内联标签保护)
│   ├── engine.ts                     # 核心翻译引擎 + 进度条 + 术语保护接入
│   ├── term-protector.ts             # 🛡️ 术语保护: 占位符替换/还原 + 术语表加载
│   ├── translation-cache.ts          # 💾 缓存实现 (JSONL 持久化)
│   ├── cached-translator.ts         # 💾 缓存装饰器 (包裹任意后端, 统一断点续跑)
│   └── global.d.ts
├── dist/                             # 预编译产物 (可直接 node dist/cli.js 使用)
├── package.json
├── tsconfig.json
├── CHANGELOG.md
└── README.md
```

---

## 🔧 DeepL 配置

1. 注册 DeepL API Free：https://www.deepl.com/pro-api
2. 在 Account → API keys 创建 key（Free key 以 `:fx` 结尾）
3. 端点自动选择：
   - key 以 `:fx` 结尾 → `api-free.deepl.com`（Free）
   - 其他 key → `api.deepl.com`（Pro）
   - 也可用 `--free` / `--pro` 强制指定
4. 免费额度 500,000 字符/月，超出返回 456（不会自动扣费）

环境变量方式：

```bash
export DEEPL_API_KEY="你的KEY:fx"
# 强制 Free 端点（可选）
export DEEPL_FREE=true
```

---

## 🔌 切换 / 新增翻译后端

v2.2 起已内置 **DeepL** / **Google** / **LibreTranslate** 三后端，用 `--backend` 切换。如需接入 Azure、Ollama 等，只需：

1. 新建 `src/xxx-translator.ts`，实现 `ITranslator` 接口（`translate` / `translateBatch`）
2. 在 `translator.ts` 的 `createTranslator()` 工厂里加一个 `case`（**缓存装饰器已在此层统一包裹，新后端自动获得断点续跑**）
3. 在 `cli.ts` 的 `--backend` 选项描述里加上名字

```ts
// 示例：自定义后端只需实现一个接口
class MyTranslator implements ITranslator {
  async translate(text: string): Promise<string> { ... }
  async translateBatch(texts: string[]): Promise<string[]> { ... }
}
```

---

## 📄 License

MIT

---

## 🐛 常见问题排查

### `langCode must be a non-empty string`
这是 `deepl-node` v1 的签名问题，不是你的 key 或语言代码错了。`translateText` 的正确签名是**位置参数**：

```ts
// ✅ 正确 (deepl-node v1)
client.translateText(texts, sourceLang, targetLang, options);
// sourceLang 为 null = 自动检测；options = { formality, glossary, preserve_formatting }
```

本项目 `translator.ts` 已按此实现。**不要把 `target_lang`/`source_lang` 塞进 options 对象**——SDK 会把 options 当第二个参数 `sourceLang` 解析，进而校验 `sourceLang.langCode` → 报上述错误。

- `--source` 留空或不传 = 自动检测（内部归一化为 `null`，不会传空字符串）
- 目标语言用小写别名也行（`zh`/`zh-CN` → `ZH`，`pt-br` → `PT-BR`），由 `normalizeLang` 处理

### `.d.ts` 文件被跳过（`Files skipped`）
已修复：`path.extname('index.d.ts')` 返回 `.ts`，现改用「路径是否以扩展名结尾」匹配，`.d.ts` 可正常处理。

### 开了 `--cache-dir` 但 `saved` 一直是 0
确认重跑时 `--backend` / `--target` / `--source-lang` 完全一致，缓存 key = `SHA-1(原文 + 后端 + 源语言 + 目标语言)`，任一项不同都会不命中。

### LibreTranslate 报连接失败
先 `curl http://localhost:5000/languages` 验证服务可达；公共实例有速率限制，建议 Docker 自托管。

### `{@link}` 被翻译了 / 注释"翻译不完全"
正常情况下术语保护会拦截内联标签、多行结构保留会还原换行。若仍异常，用 `--dry-run -v` 查看还原前后对比，确认 `Terms protected` 计数 > 0。
