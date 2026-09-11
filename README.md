# Comment Translator

> 智能 JSDoc / 行内注释翻译工具 —— 保留结构、保护术语、支持断点续跑。

Comment Translator 专为解决 **.d.ts / .ts 注释机器翻译后"翻译不完全"** 而设计：
保留 JSDoc 多行结构、`@param` / `@remarks` 等标签、`{@link}` 内联标签与术语原样，
只翻译正文部分。支持 **DeepL / Google / LibreTranslate** 三大后端，并内置**翻译缓存**实现断点续跑。

适用场景：Minecraft Bedrock 脚本 API、大型 TypeScript 声明文件、SDK 文档本地化等。

---

## ✨ 功能特性

- 🧠 **结构感知**：解析 JSDoc AST，多行描述逐行对齐，翻译后缩进 / 空行 / 标签顺序原样保留
- 🛡️ **术语 & 内联标签保护**：`{@link}`、`{@code}`、`BlockPermutation` 等不会被翻译 API 篡改
- 💾 **翻译缓存（断点续跑）**：以 `SHA-1(原文 + 后端 + 语言对)` 为 key 持久化，**中断后重跑只翻剩余部分**，节省 API 配额
- 🌐 **多后端**：DeepL（官方 / 免费）、Google Translate（服务账号）、LibreTranslate（自托管 / 公共实例）
- 🔑 **术语表**：可选 `glossary.json` 强制指定专有名词译法
- 📦 **开箱即用**：`dist/` 已预编译，无需先 `tsc`

---

## 📦 安装

```bash
# 1. 解压后进入目录
cd comment-translator
npm install
```

> 依赖：`node-fetch`、`form-data`、`google-auth-library`。Node ≥ 16。

可选：自行重新编译

```bash
npm run build      # tsc -> dist/
```

---

## 🚀 快速开始

### 最小用法（Mock 模式，无需 API Key）

```bash
node dist/cli.js ./src --mock --target zh -o ./out
```

### 真实后端

```bash
# DeepL 官方（pro）
node dist/cli.js ./src --backend deepl --api-key YOUR_KEY:fx --target zh

# DeepL 免费（free）
node dist/cli.js ./src --backend deepl-free --api-key YOUR_FREE_KEY --target zh

# Google Translate（服务账号 JSON）
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
node dist/cli.js ./src --backend google --target zh

# LibreTranslate（公共实例，通常无需 key）
node dist/cli.js ./src --backend libretranslate --libre-url https://libretranslate.example.com --target zh

# LibreTranslate Docker 自托管
docker run -d -p 5000:5000 libretranslate/libretranslate
node dist/cli.js ./src --backend libretranslate --libre-url http://localhost:5000 --target zh
```

---

## 💾 翻译缓存 / 断点续跑（重点）

缓存默认关闭，**加 `--cache-dir` 即开启**。开启后：

- 已翻译的文本直接命中缓存，不再请求 API
- 进程中断（Ctrl+C / 网络失败 / 配额耗尽）后，**用完全相同的命令重跑**，只翻译剩余未缓存部分
- 缓存按 `后端 + 源语言 + 目标语言` 自动分文件，不同语言对互不干扰

```bash
# 首次运行：全量翻译，同时写入缓存
node dist/cli.js ./src --backend libretranslate --target zh --cache-dir .cache

# 中断后重跑：已翻译的 0 次 API 调用，仅翻新增/未命中部分
node dist/cli.js ./src --backend libretranslate --target zh --cache-dir .cache

# 强制忽略缓存，全部重翻
node dist/cli.js ./src --no-cache --target zh

# 清空缓存后从头翻译
node dist/cli.js ./src --clear-cache --target zh
```

缓存文件示例：`.cache/libretranslate-auto-zh.jsonl`（JSONL 追加写，进程结束自动 flush）。

**判断缓存是否生效**：日志中 `API calls: X → saved Y calls`，`Y > 0` 即表示命中。

---

## 🛡️ 术语表（可选）

新建 `glossary.json`（精确匹配，优先级高于翻译 API）：

```json
{
  "BlockPermutation": "方块排列",
  "Molang": "Molang",
  "Dimension": "维度"
}
```

```bash
node dist/cli.js ./src --glossary ./glossary.json --target zh
```

---

## 🔧 完整 CLI 参数

| 参数 | 说明 | 默认 |
|------|------|------|
| `<input>` | 输入文件或目录 | 必填 |
| `-o, --output` | 输出目录（缺省则原地生成 `.translated.ts`） | — |
| `--backend` | `deepl` / `deepl-free` / `google` / `libretranslate` / `mock` | `deepl` |
| `--api-key` | DeepL API Key | — |
| `--target` | 目标语言代码（`zh` / `en` / `ja` …） | `zh` |
| `--source-lang` | 源语言（自动检测可省略） | auto |
| `--libre-url` | LibreTranslate 服务地址 | `http://localhost:5000` |
| `--libre-key` | LibreTranslate API Key（公共实例可省略） | — |
| `--cache-dir` | 缓存目录，**指定即开启断点续跑** | 关闭 |
| `--no-cache` | 本次运行忽略已有缓存 | false |
| `--clear-cache` | 运行前清空缓存 | false |
| `--glossary` | 术语表 JSON 路径 | — |
| `--no-progress` | 禁用进度条 | false |

---

## 📝 翻译效果示例

**输入**（Minecraft Bedrock API，翻译不完全的典型场景）：

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

**输出**（结构 / 术语 / 内联标签完整保留）：

```typescript
/**
 * @remarks
 * Sets the block in the dimension
 * to the permuted state.
 * @privilege
 * no-restricted-execution - This function can't be called in restricted-execution mode.
 * @param
 * The permutation
 * containing the set of
 * attribute states for the block.
 * @throws
 * This function may throw an error.
 *
 * {@link LocationInUnloadedChunkError}
 * {@link LocationOutOfWorldBoundariesError}
 */
setPermutation(permutation: BlockPermutation): void;
```

---

## 🏗️ 项目结构

```
src/
├── cli.ts                      # 命令行入口 / 参数解析
├── engine.ts                   # 翻译编排引擎
├── parser.ts                   # 源码 → 注释提取
├── jsdoc-parser.ts             # JSDoc AST 解析（多行/标签/内联）
├── term-protector.ts           # 术语 & {@link} 保护
├── translator.ts               # 后端工厂 createTranslator()
├── translation-cache.ts        # 缓存实现（JSONL 持久化）
├── cached-translator.ts        # 缓存装饰器（包裹任意后端）
├── deepl-translator.ts        # DeepL 后端
├── google-translator.ts        # Google 后端
├── libretranslate-translator.ts # LibreTranslate 后端
└── mock-translator.ts          # Mock 后端（无需 Key 的测试用）
```

---

## ⚠️ 常见问题

**Q：开了 `--cache-dir` 但 `saved` 一直是 0？**
确认重跑时 `--backend` / `--target` / `--source-lang` 完全一致，缓存按这三项分文件。

**Q：LibreTranslate 报连接失败？**
先 `curl http://localhost:5000/languages` 验证服务可达；公共实例有速率限制，建议自托管。

**Q：`{@link}` 被翻译了？**
正常情况下术语保护会拦截；若自定义了术语表，确保未把 `link` 之类列入。

---

## 📄 License

MIT
