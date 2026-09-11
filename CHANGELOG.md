# Changelog

## [2.5.0] - 2026-09-11
### Added — 语义润色模式 (Semantic Polishing)
- **`--polish` 开关**: 翻译 + 术语还原之后，对每段译文再做一次「语义润色」，让机翻读起来像人写的技术文档。默认关闭，加 `--polish` 即开启。
- **双层实现** (`src/polisher.ts`)：
  1. **提示词 LLM 重写** —— 按风格动态生成系统提示词，明确要求「只输出译文、保留代码标识符 / `{@link}` / 反引号代码块 / 占位符、保持行结构」，支持 `formal` / `tech-writing` / `concise` / `friendly` 四种风格（`--polish-style`）。
  2. **译后规则清理**（本地、零成本）—— 去重复空格与空行、统一全半角标点（`。，` → `。`）、剥离「翻译:」等引擎前缀、逐行 trim。规则始终生效，LLM 只做加分。
- **LLM 后端抽象** (`src/llm-client.ts`)：统一对接 **OpenAI 兼容接口**（OpenAI / DeepSeek / 通义 / 月之暗面等）+ **Ollama 本地**（自动适配 `/api/chat` 与 `/v1/chat/completions`），零第三方依赖（Node 原生 fetch），含超时与 4xx/5xx 分级重试。
- **独立缓存**：润色结果以 `style + 目标语言 + 原文` 为 key 落盘，断点续跑自动复用，不重复消耗 LLM 配额（`--no-polish-cache` 可关闭）。
- **优雅降级**：LLM 报错时自动退回规则模式，绝不中断翻译流程（`--rules-only` 可彻底跳过 LLM）。
- **CLI 参数**：`--polish` `--polish-style` `--rules-only` `--no-polish-cache` `--llm-provider` `--llm-base-url` `--llm-api-key` `--llm-model`。
- **测试覆盖**：`polisher.test.ts`（27 项，规则清理 / 风格提示词 / 缓存隔离 / Ollama 协议 / LLM 降级 / `fromFlags`）＋ `smoke-polish.ts`（端到端 8 项：rules-only / LLM 路径 / 降级不崩溃 / 缓存命中免调 LLM）。

### Changed
- `engine.ts`：在「翻译 → 术语还原」之后插入 polisher 步骤，并在退出时 `flush` 润色缓存。
- `translation-cache.ts`：暴露 `hash()` 静态方法供 polisher 复用统一 key 规则。
- 版本号升至 2.5.0。


## [2.4.2] - 2026-09-11
### Docs
- 合并主线 README 与 v2.4.x 新功能：将 DeepL/Google 详细术语保护、常见问题排查等完整内容，与 LibreTranslate 后端、翻译缓存断点续跑整合为统一文档
- 新增 Minecraft Bedrock API 结构保留示例、完整 CLI 参数表（含 `--libre-*` / `--cache-*`）、三后端对照的快速开始
- 项目结构同步到实际文件（libretranslate-translator / cached-translator / translation-cache 等）

## [2.4.1] - 2026-09-11
### Docs
- 重写 README：补全 LibreTranslate / Google 用法、缓存断点续跑说明、完整 CLI 参数表、项目结构与 FAQ
- 移除已过时的示例与占位内容

## [2.4.0] - 2026-09-11

### Added
- **翻译缓存（断点续跑）**: 所有翻译后端（DeepL / Google / LibreTranslate）现在默认支持磁盘缓存。
  - 以「源文 + 源语言 + 目标语言 + 后端」为 key，不同语言对 / 后端互不干扰。
  - 持久化为 JSONL（追加写 + 进程退出前 `flushSync`），中断后重跑同一命令即可从已完成处继续，无需重翻。
  - 集成点统一提升到 `createTranslator()` 工厂，调用方（CLI / 程序化 API）自动获得缓存，无需手动装饰。
- **`--libretranslate` 后端正式接入工厂**: `--backend libretranslate` 现在真正可用（此前会抛 "Unknown backend"）；新增 `--libre-url` / `--libre-key` CLI 参数。
- **缓存 CLI 选项**: `--cache-dir <path>`（默认 `.comment-translator-cache`）、`--no-cache`（禁用）、`--clear-cache`（清空后重跑）。

### Changed
- 版本号升至 2.4.0。

## [2.3.1] - 2026-09-11

### Fixed
- **翻译不完全 (Translation incomplete)**: 修复了多行 JSDoc 标签描述（如 `@remarks`、`@param`、`@throws`）在翻译后丢失行结构的问题。现在翻译后的描述会保留原始的多行排版。
- **多余空行**: 修复了 `parseJSDoc` 在解析多行标签描述时，描述前导换行符导致的 `@privilege` 等标签后出现多余空行的问题。
- **`{@link}` / `{@code}` 内联标签保护**: 
  - 在 `jsdoc-parser.ts` 中新增 `isInlineOnly()` 检测，纯内联标签行（如仅包含 `{@link FooBar}` 的行）不再发送到翻译 API。
  - 在 `term-protector.ts` 中新增 JSDoc 内联标签保护规则，`{@link}`、`{@linkcode}`、`{@linkplain}`、`{@code}`、`{@inheritdoc}` 现在会被占位符替换，翻译后无损还原。
- **`looksLikeProse` 忽略内联标签**: 判断是否为自然语言时不再把 `{@link ...}` 当作正文内容。

### Changed
- `applyTranslations` 现在对多行标签描述使用 `applyTextToDescription` 逻辑，按原始行数重新分配翻译结果。
- 版本号从 2.3.0 升级到 2.3.1。
