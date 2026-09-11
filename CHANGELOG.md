# Changelog

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
