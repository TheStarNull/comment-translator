# Changelog

## [2.3.1] - 2026-09-11

### Added
- **LibreTranslate 后端支持** — 新增 `--backend libretranslate` 选项，完全免费、支持自托管。新增文件 `src/libretranslate.ts`，通过 `ITranslator` 接口无缝集成。支持 `--libre-url`（自定义服务地址）和 `--libre-key`（API Key）参数。

### Fixed

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
