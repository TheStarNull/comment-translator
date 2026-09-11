# Comment Translator 🌐 (v2.3.1)

一个专门翻译 **JSDoc** 和代码注释的工具，支持 **JavaScript / TypeScript**（含 `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`），通过 **DeepL** 或 **Google Translate API** 进行翻译，输出翻译后的文件。

> 默认使用 **DeepL**（翻译质量更高，Free 版每月 50 万字符免费额度）；可通过 `--backend google` 一键切换到 **Google Translate**（覆盖 130+ 语言，免费额度同为 50 万字符/月）。

## ✨ 功能特性

- 🔍 **智能解析** — 精确提取 JSDoc、块注释、行注释
- 🏷️ **JSDoc 感知** — 识别 `@param` `@returns` `@example` `@beta` `@remarks` 等标签，只翻译描述部分，保留类型与参数名
- 📦 **批量翻译** — 自动合并文本进行批量 API 调用，提高效率
- 🌍 **多后端** — **DeepL**（默认，质量优先）／**Google**（覆盖广、价格低）／**LibreTranslate**（免费开源，可自托管），用 `--backend` 切换；新增后端只需实现一个类
- 🆓 **LibreTranslate 支持 (v2.3.1)** — 完全免费、无需 API Key（部分公共实例）、支持自托管（`docker run -p 5000:5000 libretranslate/libretranslate`），`--backend libretranslate` 即可启用
- 🌍 **多语言支持** — 取决于所选后端：DeepL 支持 ZH/ZH-HANT/EN/JA/KO/DE/FR/ES/RU/PT-BR 等；Google 支持 130+ 语言（zh-CN / zh-TW / ja / ko ...）；LibreTranslate 支持 30+ 语言（zh / en / ja / ko / de / fr ...）
- 📁 **目录递归** — 支持单文件或整个目录批量处理
- 🎯 **格式保持** — 翻译后保持原始缩进、星号前缀等格式
- 🧪 **Mock 模式** — 内置模拟翻译器，无需 API Key 即可测试
- 🔑 **术语表 / 模型** — DeepL Glossary；Google `base` / `nmt` 模型
- 🛡️ **术语保护 (v2.3)** — 自动保护代码标识符（`camelCase`/`PascalCase`/`snake_case`/`UPPER_CASE`）、URL、反引号代码块、占位符（`%s`/`${name}`），并支持自定义术语表，避免 API 误翻专有名词
- 🛡️ **JSDoc 内联标签保护 (v2.3.1)** — `{@link}` / `{@code}` / `{@linkcode}` / `{@linkplain}` / `{@inheritdoc}` 现在自动占位保护，翻译后无损还原
- 📐 **多行描述结构保留 (v2.3.1)** — `@remarks` / `@param` / `@throws` 等跨多行的描述翻译后保留原始行数和缩进，不再压缩成单行
- ⚡ **自动重试** — 对限流（429）、配额（456）、5xx 错误自动退避重试

## 📦 安装

```bash
cd comment-translator
npm install
npm run build
```

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

> 💡 选择建议：**主要语言 + 翻译质量优先 → DeepL**；**小语种 / 多语言覆盖广 / 成本敏感 → Google**（Google 每百万字符约 \$20，DeepL Pro 约 \$25+固定费）。

### 方式四：LibreTranslate（`--backend libretranslate`）🆓

LibreTranslate 是 **100% 免费开源**的翻译引擎，无需 API Key 即可使用公共实例，也可以自行 Docker 部署。

**选项 A：使用公共实例（无需注册）**

```bash
# 直接使用（无需 API Key）
node dist/cli.js ./src --backend libretranslate --target zh -o ./out
```

**选项 B：自托管（推荐，无速率限制）**

```bash
# 1. 启动 LibreTranslate 服务
docker run -d -p 5000:5000 libretranslate/libretranslate

# 2. 指定本地服务地址
node dist/cli.js ./src --backend libretranslate --libre-url http://localhost:5000 --target zh
```

**选项 C：使用带 API Key 的公共实例**

```bash
export LIBRETRANSLATE_API_KEY="your-api-key"
node dist/cli.js ./src --backend libretranslate --target en
```

| 公共实例 | URL | API Key |
|----------|-----|---------|
| LibreTranslate.com | https://libretranslate.com | 需要 |
| Argos OpenTech | https://translate.argosopentech.com | 不需要 |
| libretranslate.de | https://libretranslate.de | 不需要 |

> 💡 LibreTranslate 支持 30+ 语言（zh / en / ja / ko / de / fr / es / ru ...），语言代码统一用小写（如 `zh`、`en`、`ja`）。

### 方式三：Mock 模式（无需 API Key）

```bash
npm run build && node dist/test-demo.js
# 或
node dist/cli.js ./src --mock --target zh
```

## 📝 命令行参数

```
Arguments:
  <input>                        输入文件或目录

Options:
  -o, --output <path>            输出目录或文件路径
  -t, --target <lang>            目标语言代码 (默认: "ZH")
                                 DeepL: ZH/ZH-HANT/EN/JA/KO/DE/FR/ES/RU/PT-BR...
                                 Google: zh-CN/zh-TW/en/ja/ko/de/fr/es/...
  -s, --source <lang>            源语言代码 (可选, 默认自动检测)
  -b, --backend <name>           翻译后端: deepl | google (默认: deepl)
  -k, --api-key <key>            API Key (DeepL: DEEPL_API_KEY / Google: GOOGLE_API_KEY)
  --free                         DeepL: 强制 Free 端点 (api-free.deepl.com)
  --pro                          DeepL: 强制 Pro 端点 (api.deepl.com)
  --formality <level>            DeepL 语气: default|prefer_less|prefer_more|less|more
  --glossary <id>               DeepL 术语表 ID
  --google-model <model>         Google 模型: base | nmt (默认: nmt)
  --google-credentials <path>    Google 服务账号 key.json 路径
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

## 🛡️ 术语保护 (v2.3)

翻译 API 经常会把 **API 名、变量名、URL** 一起翻译或改写（例如把 `WorldClockReloadTimeMarkerError` 拆成多个词），导致译文里的代码引用失效。v2.3 引入术语保护，在翻译前把这些片段替换成占位符，翻译后再还原原文——对 DeepL / Google 完全透明。

### 保护对象

| 类别 | 示例 | 说明 |
|------|------|------|
| 代码标识符（默认开） | `onCreate`、`WorldClock`、`scoreboard`、`MAX_RETRY` | camelCase / PascalCase / snake_case / UPPER_CASE |
| URL（默认开） | `https://example.com` | 完整保留 |
| 反引号代码（默认开） | `` `registerClock()` `` | 完整保留 |
| 占位符（默认开） | `%s`、`${name}`、`{0}` | printf / 模板字符串 |
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

## 🏗️ 项目结构

```
comment-translator/
├── src/
│   ├── cli.ts              # 命令行入口 (--backend 参数)
│   ├── translator.ts       # ITranslator 接口 + DeepLTranslator + 工厂 createTranslator()
│   ├── google-translator.ts# Google Cloud Translation API 封装
│   ├── google-auth.ts      # Google 服务账号 JWT 签名 (纯 Node crypto, 无新依赖)
│   ├── mock-translator.ts  # 模拟翻译器 (测试用)
│   ├── parser.ts           # 注释提取与还原
│   ├── jsdoc-parser.ts     # JSDoc 标签解析 (含 @beta/@remarks 修复)
│   ├── engine.ts           # 核心翻译引擎 + 进度条 + 术语保护接入
│   ├── term-protector.ts    # 🛡️ 术语保护: 占位符替换/还原 + 术语表加载
│   └── test-demo.ts        # 演示/测试入口
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

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

## 🔌 切换 / 新增翻译后端

v2.2 起已内置 **DeepL** 与 **Google** 双后端，用 `--backend deepl|google` 切换。如需接入 LibreTranslate、Azure、Ollama 等，只需：

1. 新建 `src/xxx-translator.ts`，实现 `ITranslator` 接口（`translate` / `translateBatch`）
2. 在 `translator.ts` 的 `createTranslator()` 工厂里加一个 `case`
3. 在 `cli.ts` 的 `--backend` 选项描述里加上名字

```ts
// 示例：自定义后端只需实现一个接口
class MyTranslator implements ITranslator {
  async translate(text: string): Promise<string> { ... }
  async translateBatch(texts: string[]): Promise<string[]> { ... }
}
```

## 📄 License

MIT

## 🐛 常见问题排查

**`langCode must be a non-empty string`**
这是 `deepl-node` v1 的签名问题，不是你的 key 或语言代码错了。
`translateText` 的正确签名是**位置参数**：

```ts
// ✅ 正确 (deepl-node v1)
client.translateText(texts, sourceLang, targetLang, options);
//                         ↑            ↑            ↑ 纯对象，不要包 target_lang/source_lang
// sourceLang 为 null = 自动检测；options = { formality, glossary, preserve_formatting }
```

本项目 `translator.ts` 已按此实现。若你自定义代码，注意**不要把 `target_lang`/`source_lang` 塞进 options 对象**——
SDK 会把 options 当第二个参数 `sourceLang` 解析，进而校验 `sourceLang.langCode` → 报上述错误。

- `--source` 留空或不传 = 自动检测（内部归一化为 `null`，不会传空字符串）
- 目标语言用小写别名也行（`zh`/`zh-CN` → `ZH`，`pt-br` → `PT-BR`），由 `normalizeLang` 处理

**`.d.ts` 文件被跳过（`Files skipped`）**
已修复：`path.extname('index.d.ts')` 返回 `.ts`，现改用「路径是否以扩展名结尾」匹配，`.d.ts` 可正常处理。
