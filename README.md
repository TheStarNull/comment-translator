# Comment Translator 🌐 (v2.5.1)

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
- ✨ **语义润色 (v2.5.0)** — `--polish` 开启，在翻译 + 术语还原之后做「LLM 提示词重写 + 本地规则清理」，让译文读起来像人写的技术文档；支持 OpenAI / DeepSeek / Ollama 本地等多种 LLM
- 🧪 **Mock 模式** — 内置模拟翻译器，无需 API Key 即可测试

---

## 📦 安装

```bash
cd comment-translator
npm install
npm run build    # 编译到 dist/（也可直接用包内预编译的 dist/）
```

依赖：`chalk`、`commander`、`deepl-node`、`dotenv`。所有网络请求使用 Node 原生 `fetch`（无需 `node-fetch` / `form-data`），Google 服务账号鉴权使用 Node 内置 `crypto`（无需 `google-auth-library`）。**Node ≥ 18**。

可选依赖：`typescript`（列于 `optionalDependencies`）。装上后 `.jsx` / `.tsx` 会走 TypeScript 官方 parser 做注释提取，能正确处理 **JSX 文本里的 `//`**（如 `https://`）、`{/* 注释 */}` 以及 `<T,>` 泛型箭头。**不装也不影响运行**——`.ts/.js/.mjs/.cjs` 始终使用零依赖词法器，结果完全一致；仅 JSX 文本的识别精度下降。

> 注释提取对**正则字面量**与**模板字面量**是安全的：`const re = /[/*]/`、`const u = /https?:\/\//` 里的分隔符不会被误判为注释，`` `${ v /* 真注释 */ }` `` 里的注释也能被正确提取。

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

缓存**默认开启**（默认目录 `.comment-translator-cache`，可用 `--cache-dir <dir>` 改到别处）。用 `--no-cache` 可完全关闭。开启后：

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

缓存文件：`.comment-translator-cache/libretranslate-auto-zh.jsonl`（JSONL 追加写，进程结束自动 flush）。

**判断缓存是否生效**：运行结束会打印 `[Cache] hits=…, misses=…, hit-rate=…% (saved N API calls)`，`hits > 0`（即 `saved N > 0`）表示命中。需要逐步的命中/未命中日志时，加 `--verbose`。

> 若 `saved` 一直为 0，确认重跑时 `--backend` / `--target` / `--source` 与首次完全一致——缓存 key 包含这三项。

---

## ✨ 语义润色模式 (v2.5.0)

机翻（DeepL / Google / LibreTranslate）追求"准确"，但常留下翻译腔：**重复标点、空格、`翻译:` 前缀、生硬语序**。语义润色在「翻译 → 术语还原」之后，对每段译文再做一次轻量改写，让它读起来像人写的技术文档。

### 它做什么（两层）

| 层 | 说明 | 成本 |
|----|------|------|
| **① LLM 提示词重写** | 把译文 + 原文上下文发给 LLM，要求「只输出润色后译文、保留标识符 / `{@link}` / 反引号代码块、保持行结构」 | 1 次 LLM 调用 / 段（命中缓存则不调用） |
| **② 本地规则清理** | 去重复空格与空行、统一全半角标点（`。。`→`。`、`...`→`…`）、剥离「翻译:」前缀、逐行 trim | 纯本地，零成本 |

② 始终生效；① 可通过 `--rules-only` 跳过。**LLM 报错时自动退回规则模式，绝不中断翻译**。

### 风格预设 (`--polish-style`)

- `tech-writing`（默认）— 主动语态、动词开头，参考 Microsoft / Google API 文档风格
- `formal` — 正式书面语
- `concise` — 极致精简，一条注释一个要点
- `friendly` — 亲切易懂，面向初学者

### 快速开始

```bash
# 1) OpenAI（默认，需 OPENAI_API_KEY）
export OPENAI_API_KEY="sk-..."
node dist/cli.js ./src --backend deepl --target zh --polish

# 2) 指定风格
node dist/cli.js ./src --target zh --polish --polish-style concise

# 3) DeepSeek / 任意 OpenAI 兼容接口
node dist/cli.js ./src --target zh --polish \
  --llm-provider openai --llm-base-url https://api.deepseek.com/v1 --llm-model deepseek-chat

# 4) 通义千问 / 月之暗面 / 自建网关 —— 同样走 --llm-base-url，换 URL + key 即可

# 5) Ollama 本地（完全离线、免费）
ollama pull qwen2.5 && ollama serve   # 默认 http://localhost:11434
node dist/cli.js ./src --target zh --polish \
  --llm-provider ollama --llm-base-url http://localhost:11434 --llm-model qwen2.5

# 6) 仅规则清理（不调 LLM，零额外成本，适合 CI / 纯去噪）
node dist/cli.js ./src --target zh --polish --rules-only
```

### CLI 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--polish` | off | 开启语义润色 |
| `--polish-style` | `tech-writing` | `formal` / `tech-writing` / `concise` / `friendly` |
| `--rules-only` | off | 跳过 LLM，仅本地规则清理 |
| `--no-polish-cache` | off | 每次重跑都重新润色（关闭润色结果缓存） |
| `--llm-provider` | `openai` | `openai`（兼容接口）/ `ollama` |
| `--llm-base-url` | OpenAI: `https://api.openai.com/v1` / Ollama: `http://localhost:11434` | LLM 端点 |
| `--llm-api-key` | `$OPENAI_API_KEY` | LLM API Key（Ollama 通常不需要） |
| `--llm-model` | OpenAI: `gpt-4o-mini` / Ollama: `qwen2.5` | 模型名 |

环境变量：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OLLAMA_BASE_URL`、`OLLAMA_MODEL`。

### 润色结果也支持断点续跑

润色结果以 `style + 目标语言 + 原文` 为 key 单独缓存（`polish-any-zh.jsonl` 等）。已润色过的段落重跑时直接读盘，**不再消耗 LLM 配额**——与翻译缓存共享 `--cache-dir`，用 `--no-polish-cache` 可单独关闭。

### 效果示例

```
原文:    Sets the block in the dimension to the permuted state.
机翻:    将尺寸中的块设置为置换的状态。
                        ↑ 翻译腔："尺寸"应指 dimension，但整句生硬
润色后: 将指定维度中的方块设置为置换后的状态。
```

> LLM 只会改写自然语言部分；`BlockPermutation`、`{@link XxxError}`、`` `register()` ``、`%s` 等受术语保护的对象逐字保留。

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
  -b, --backend <name>           翻译后端: deepl | google | libretranslate (默认: deepl；--mock 切换到模拟翻译器)
  -k, --api-key <key>            API Key
  --free                         DeepL: 强制 Free 端点 (api-free.deepl.com)
  --pro                          DeepL: 强制 Pro 端点 (api.deepl.com)
  --formality <level>            DeepL 语气: default|prefer_less|prefer_more|less|more
  --glossary <id>               DeepL 术语表 ID
  --google-model <model>         Google 模型: base | nmt (默认: nmt)
  --google-credentials <path>    Google 服务账号 key.json 路径
  --libre-url <url>              LibreTranslate 服务地址 (默认: http://localhost:5000)
  --libre-key <key>              LibreTranslate API Key (公共实例可省略)
  --timeout <ms>                 单次网络请求超时毫秒数 (默认: 30000)
  --cache-dir <dir>              缓存目录 (默认: .comment-translator-cache；缓存默认开启)
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
  --no-protect-placeholders     不保护 %s / %d / {0} / ${name} 占位符
  --no-protection               完全关闭术语保护（标识符/URL/代码块按字面翻译）

  # --- 语义润色 (v2.5.0) ---
  --polish                       开启语义润色（LLM 重写 + 本地规则清理）
  --polish-style <style>         风格: formal|tech-writing|concise|friendly (默认: tech-writing)
  --rules-only                   跳过 LLM，仅本地规则清理（零额外成本）
  --no-polish-cache              禁用润色结果缓存（每次重跑重新润色）
  --llm-provider <name>          LLM 提供者: openai|ollama (默认: openai)
  --llm-base-url <url>           LLM 端点 (OpenAI: https://api.openai.com/v1, Ollama: http://localhost:11434)
  --llm-api-key <key>            LLM API Key ($OPENAI_API_KEY)
  --llm-model <name>             模型 (OpenAI: gpt-4o-mini, Ollama: qwen2.5)
```

---

## 🛡️ 术语保护 (v2.3)

翻译 API 经常会把 **API 名、变量名、URL** 一起翻译或改写（例如把 `WorldClockReloadTimeMarkerError` 拆成多个词），导致译文里的代码引用失效。v2.3 引入术语保护，在翻译前把这些片段替换成占位符，翻译后再还原原文——对 DeepL / Google / LibreTranslate 完全透明。

> **术语保护默认开启**，无需任何参数——下表中「默认开」的类别开箱即用。
> 需要按类别关闭用 `--no-protect-*`；想彻底关掉（按字面翻译标识符）用 `--no-protection`。
> 运行结束的 Summary 中会显示 `Terms protected: <count>`，为 0 或缺失即表示未生效。

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

# 4) 默认即保护（无需任何参数）——Summary 会出现 "Terms protected: N"
node dist/cli.js ./src --mock --target zh

# 5) 完全关闭术语保护（按字面翻译，不插入占位符）
node dist/cli.js ./src --mock --target zh --no-protection
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
│   ├── translator.ts                 # ITranslator 接口 + DeepL 后端 + 工厂 createTranslator()
│   ├── google-translator.ts          # Google Cloud Translation API 封装
│   ├── google-auth.ts                # Google 服务账号 JWT 签名 (纯 Node crypto)
│   ├── libretranslate-translator.ts  # 🌍 LibreTranslate 后端 (v2.4.0)
│   ├── mock-translator.ts            # 模拟翻译器 (测试用)
│   ├── parser.ts                     # 注释提取与还原 (按文件类型分发)
│   ├── lexer.ts                      # 🔍 零依赖词法器 (字符串/模板 ${}/正则 消歧)
│   ├── ts-comments.ts                # 🔍 .jsx/.tsx 的 TS parser 提取 (token 间隙扫描)
│   ├── jsdoc-parser.ts               # JSDoc 标签解析 (多行/内联标签保护)
│   ├── engine.ts                     # 核心翻译引擎 + 进度条 + 术语保护接入
│   ├── term-protector.ts             # 🛡️ 术语保护: 占位符替换/还原 + 术语表加载
│   ├── translation-cache.ts          # 💾 缓存实现 (JSONL 持久化)
│   ├── cached-translator.ts          # 💾 缓存装饰器 (包裹任意后端, 统一断点续跑)
│   ├── fetch-timeout.ts              # ⏱️ 统一网络超时 (fetchWithTimeout + TimeoutError)
│   ├── llm-client.ts                 # ✨ LLM 后端抽象 (OpenAI 兼容 / Ollama, v2.5.0)
│   ├── polisher.ts                   # ✨ 语义润色: LLM 重写 + 本地规则清理 (v2.5.0)
│   ├── polisher.test.ts              # ✨ 润色单元测试 (27 项)
│   ├── smoke-polish.ts               # ✨ 润色端到端冒烟测试 (8 项)
│   ├── test-demo.ts                  # Mock 流程演示 (npm test)
│   ├── test-cache.ts                 # 缓存单元测试
│   ├── test-cache-e2e.ts             # 缓存端到端 (中断续跑) 测试
│   ├── test-cache-resume.ts          # 缓存断点续跑集成测试 (npm run test:cache)
│   ├── term-protector.test.ts        # 🛡️ 占位符往返回归测试 (npm run test:terms)
│   ├── test-protection-default.ts    # 🛡️ 术语保护默认开启 E2E 测试 (npm run test:protection)
│   ├── test-timeout.ts               # ⏱️ 网络超时回归测试 (npm run test:timeout)
│   ├── parser.test.ts                # 🔍 注释提取回归测试 (npm run test:parser)
│   └── global.d.ts
├── dist/                             # 预编译产物 (可直接 node dist/cli.js 使用)
├── package.json
├── tsconfig.json
├── CHANGELOG.md
├── QUICKSTART.md
├── .gitignore
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
确认重跑时 `--backend` / `--target` / `--source` 完全一致，缓存 key = `SHA-1(原文 + 后端 + 源语言 + 目标语言)`，任一项不同都会不命中。

### LibreTranslate 报连接失败
先 `curl http://localhost:5000/languages` 验证服务可达；公共实例有速率限制，建议 Docker 自托管。

### `{@link}` 被翻译了 / 注释"翻译不完全"
正常情况下术语保护会拦截内联标签、多行结构保留会还原换行。若仍异常，用 `--dry-run -v` 查看还原前后对比，确认 `Terms protected` 计数 > 0。

### `--polish` 后没看到效果
- 若只用 `--rules-only`，效果主要是去噪（标点/空格/前缀），语义改写需走 LLM；
- LLM 路径要**真正调用到**才生效：确认 `--llm-provider` / `--llm-base-url` / `--llm-api-key` 正确，且日志无 `network down` 类错误（出错会自动降级到 rules，不会报错）；
- 加了 `--no-polish-cache` 后又重跑，旧结果不会复用，属正常。

### Ollama 报连接失败
`ollama serve` 默认监听 `11434`，先 `curl http://localhost:11434/api/tags` 验证；`--llm-model` 必须是已 `ollama pull` 过的模型名（如 `qwen2.5`）。

### 润色消耗太多 LLM 配额
- 首次全量会逐段调用 LLM；**重跑命中 `--cache-dir` 下的 `polish-*.jsonl` 后不再调用**；
- 或对已完成的项目直接用 `--rules-only` 做低成本去噪。

---
