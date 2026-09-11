# Comment Translator 🌐

一个专门翻译 **JSDoc** 和代码注释的工具，支持 **JavaScript / TypeScript**（含 `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`），通过 **DeepL Translate API**（Free / Pro）进行翻译，输出翻译后的文件。

> 本项目最初基于 Google Translate，现已**全面迁移到 DeepL**。DeepL 翻译质量更高，Free 版提供每月 50 万字符免费额度。

## ✨ 功能特性

- 🔍 **智能解析** — 精确提取 JSDoc、块注释、行注释
- 🏷️ **JSDoc 感知** — 识别 `@param` `@returns` `@example` 等标签，只翻译描述部分，保留类型与参数名
- 📦 **批量翻译** — 自动合并文本进行批量 API 调用，提高效率
- 🌍 **多语言支持** — 支持 DeepL 所有目标语言：ZH（简体）、ZH-HANT（繁体）、EN、JA、KO、DE、FR、ES、RU、PT-BR 等
- 📁 **目录递归** — 支持单文件或整个目录批量处理
- 🎯 **格式保持** — 翻译后保持原始缩进、星号前缀等格式
- 🧪 **Mock 模式** — 内置模拟翻译器，无需 API Key 即可测试
- 🔑 **术语表** — 支持 DeepL Glossary，保证术语一致性
- ⚡ **自动重试** — 对限流（429）、配额（456）、5xx 错误自动退避重试

## 📦 安装

```bash
cd comment-translator
npm install
npm run build
```

## 🚀 快速使用

### 方式一：使用真实 DeepL API

1. 注册 DeepL API Free：https://www.deepl.com/pro-api （Free key 通常以 `:fx` 结尾）
2. 配置 API Key：

```bash
export DEEPL_API_KEY="你的KEY:fx"
# 或运行时传参
```

```bash
# 翻译单个文件 → 中文（简体）
node dist/cli.js ./src/index.ts --api-key YOUR_KEY:fx --target ZH

# 翻译整个目录 → 日文
node dist/cli.js ./src --target JA -o ./output

# 使用术语表保证术语一致
node dist/cli.js ./lib --api-key KEY --glossary abc123 --target ZH

# 预览（不写文件）
node dist/cli.js ./src --api-key KEY --target ZH --dry-run -v
```

### 方式二：使用 Mock 模式（无需 API Key）

```bash
npm run build && node dist/test-demo.js
# 或
node dist/cli.js ./src --mock --target zh
```

## 📝 命令行参数

```
Arguments:
  <input>                  输入文件或目录

Options:
  -o, --output <path>      输出目录或文件路径
  -t, --target <lang>      目标语言代码 (默认: "ZH")
                           ZH(简体)/ZH-HANT(繁体)/EN/JA/KO/DE/FR/ES/RU/PT-BR...
  -s, --source <lang>      源语言代码 (可选, 默认自动检测)
  -k, --api-key <key>      DeepL API Key
  --free                   强制使用 Free 端点 (api-free.deepl.com)
  --pro                    强制使用 Pro 端点 (api.deepl.com)
  --formality <level>      语气: default|prefer_less|prefer_more|less|more
  --glossary <id>          DeepL 术语表 ID
  --mock                   使用模拟翻译器 (无需 API Key)
  --extensions <exts>      文件扩展名 (默认: ".js,.ts,.jsx,.tsx,.mjs,.cjs,.d.ts")
  --no-recursive            禁用递归目录遍历
  --dry-run                预览模式, 不写入文件
  -v, --verbose            详细输出
```

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
│   ├── cli.ts              # 命令行入口
│   ├── translator.ts       # DeepL API 封装 (ITranslator 接口)
│   ├── mock-translator.ts  # 模拟翻译器 (测试用)
│   ├── parser.ts           # 注释提取与还原
│   ├── jsdoc-parser.ts     # JSDoc 标签解析
│   ├── engine.ts           # 核心翻译引擎
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

## 🔌 切换其他翻译后端

`ITranslator` 接口（`translate` / `translateBatch`）让替换后端非常简单。只需新增一个实现类即可接入 LibreTranslate、Google、Ollama 等：

```ts
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
