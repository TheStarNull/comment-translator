# Changelog

## [2.5.2] - 2026-09-13
### Fixed
- **`@example` 代码被当作散文翻译，产出无法编译的示例**：`@example` / `@examples` / `@code` / `@pre` 的内容是**代码**而非描述，但它们此前都在 `TRANSLATABLE_TAGS` 中，因此整段会被送进翻译 API。真实后果：

  ```ts
  /**
   * @example
   * const user = getUser();      →    const 用户 = getUser();
   * return user.name;            →    返回 用户.名称;
   */
  ```

  示例代码里的标识符与关键字被译成目标语言，**文档中的示例不再可编译**。
  修复：把 `@example` / `@examples` / `@code` / `@codeblock` / `@pre` 从 `TRANSLATABLE_TAGS` 移除，并新增导出的 `VERBATIM_TAGS` / `isVerbatimTag()`，在 `extractTranslatableParts()` 与 `applyTranslations()` **两侧对称**跳过（这两处必须规则一致，否则译文会错位到别的标签上）。新增回归测试 `src/jsdoc-parser.test.ts`（40 项），其中用「转大写」的假翻译器实现——凡是被送进翻译器的文本都会在输出里显形，因此任何漏保护都能被直接观察到。测试同时覆盖：verbatim 标签与可翻译标签集合互斥、`@example` 夹在两个散文标签之间时索引不错位、多段示例体、`@see {@link X}` 等既有跳过规则不被破坏。

### Changed — ⚠️ 行为变更
- **缺少 API Key 不再静默降级为 Mock**：此前 `--backend deepl`（或 google）在未提供密钥时，只会打印一条警告，然后**悄悄改用 MockTranslator**，产出一份看起来"成功"、实为模拟的译文并以 `exit 0` 结束——在 CI 中极易被误认为真实翻译成功，进而提交一整套假译文。
  现在改为**硬错误**：打印缺失的环境变量名、给出三条修复建议，并以 `exit 1` 退出，**不写出任何文件**。若确实需要旧行为，可显式加 **`--allow-mock`**（会再次明确警告输出是模拟的）。`--mock` 仍然是显式请求模拟的方式；`libretranslate` 自托管无需密钥，不受影响。

### Added — Mock 优化与增强
- **结构保真**：模拟译文不再是「整行加前缀」的粗暴替换，而是像真实流程一样保留注释结构——
  · JSDoc 标签行保留 `@tag`、`{Type}` 类型标注、参数名与 `-` / `:` 分隔符，**只翻译描述部分**；
  · `@example` / `@code` / `@pre` 的**正文完全原样保留**；
  · 代码标识符（`BlockPermutation`、`MAX_RETRY`、`foo_bar`、`v2`）、`{@link ...}` 内联标签、`` `code span` `` 与 URL **一律不翻译**；
  · 行结构与缩进（含 ` * ` 装饰）逐行保持。
- **性能**：词典改为**每语言只编译一次**并缓存（原先每次调用都对每个词重新构造正则，约 40+ 次编译/调用）。3000 次翻译由数秒降至毫秒级；新增性能回归测试守住这一点。
- **语言扩展**：词典由 1 种（zh）扩展到 **8 种**（zh / ja / ko / es / fr / de / pt / ru），并支持 `zh-CN`、`pt-BR`、`ZH_TW` 这类**地区标签归一化**；未收录的语言（含 `en`）回退到**伪本地化**（元音变音），使输出明显区别于原文。
- **大小写保持**：`Returns` → `Retourne`（有大小写的目标语言），不会出现句首小写的别扭输出。
- **每行标记**：译文行以 `[<lang>] ` 开头（可用 `marker` 选项自定义或置空），确保模拟输出**永远不会被误认为真实翻译**。
- **可测试性**：新增 `callCount` / `reset()`，便于断言缓存命中与否。
- 新增单元测试 `src/mock-translator.test.ts`（69 项）：确定性、结构保真、代码构造不被改写、行结构/缩进、大小写、8 种语言、伪本地化回退、调用计数、边界（空串/空白/空批次/per-call 语言）、性能，以及上述 CLI 契约（无密钥必须失败、`--allow-mock` 才降级、`--mock` 可用、LibreTranslate 不被拦截）。

## [2.5.1] - 2026-09-13
### Fixed
- **注释提取误判 / 漏判（regex 字面量、模板 `${}`、JSX）**：`parser.ts` 原来是一个手写状态机，只跳过了字符串字面量，**不识别正则字面量**，也把模板字面量整段跳过。因此它会**双向出错**——既凭空造出不存在的注释（并"翻译"它们、破坏代码），又吞掉真实注释：
  - `const re = /[/*]/;` → 正则里的 `/*` 被当成块注释起始，其后整段代码被吞掉、注释永不翻译；
  - `const u = /https?:\/\//;` → 正则里的 `//` 被当成行注释；
  - `` const s = `${ v /* 真实注释 */ }`; `` → 模板 `${}` 内的**真实注释被漏掉**；
  - `const el = <a>http://x</a>;` → JSX 文本里的 `//` 被当成注释（且 `{/* 注释 */}` 漏掉、`<T,>` 泛型被误判为 JSX）。

  修复：按文件类型分发提取逻辑。
  1. 新增 `src/lexer.ts`：**零依赖、带上下文的词法器**。通过「上一个有效 token 能否结束表达式」来正确区分**正则字面量 vs 除法**（标识符 / 字符串 / 数字 / `)` / `]` 之后是除法，其余位置是正则）；**递归进入模板 `${ ... }` 子代码**，因此其中的注释能被正常提取，嵌套模板也能正确处理（`${` 内含反引号）。未被续行的未闭合字符串、未闭合块注释均安全降级。
  2. 新增 `src/ts-comments.ts`：`.jsx` / `.tsx` 交给 **TypeScript 官方 parser**。做法是遍历 AST 收集全部**叶子 token 跨度**，再把「token 之间未被覆盖的缝隙」当作 trivia 扫描注释——由于 JSX 文本、正则、`{/* */}` 都是 token，**天然不可能被误判为注释**；同时跳过 JSDoc 节点（它们描述注释本身）。
  3. `parser.ts` 的 `extractComments` 改为按扩展名分发（`.jsx/.tsx` → TS parser，其余 → lexer），两种来源统一装配成原有的 `ExtractedComment` 结构，**对调用方零变更**。

  已知限制：`typescript` 作为**可选依赖**（`optionalDependencies`）。未安装时 `.jsx/.tsx` 会回退到 lexer——此时 JSX 文本中的 `//`（如 `https://`）仍可能被误判。`.ts/.js/.mjs/.cjs` 无论是否安装均完全正确。

  新增回归测试 `src/parser.test.ts`（66 项）：覆盖正则/除法消歧、模板 `${}` 与嵌套模板、字符串、JSX 文本与 `{/* */}`、`<T,>` 泛型、结构边界，以及返回结构（`text` / `original` / 行号 / id 连续性）与「无注释代码零误报」。修复前该套件 12 项失败。

- **相邻占位符还原失效（术语静默丢失）**：`TermProtector` 在受保护片段**紧邻出现**时（无分隔符，如 `%s%s`、`{0}{1}`、`{@link A}{@link B}`、`` `a``b` ``）会把术语丢失，译文里残留不可见的 Unicode 私用区字符（U+E000–U+F8FF）。根因有二：
  1. `alloc()` 生成的占位符是**两个连续码点**且步长为 1，导致 token 的码点区间**互相重叠**（id N 占用 `U+E000+N` 与 `U+E000+N+1`），占位符并非自定界；
  2. `restore()` 用 `/[\uE000-\uF8FF]+/g` **贪婪合并**所有相邻私用区字符后整体查表，相邻的多个占位符会被并成一段、无法命中任何 key，于是被原样返回。
  修复：占位符改为**单个码点**（`restore()` 逐码点独立查表），使其自定界——相邻、重复、以及翻译器引入的空格变动均可正确还原。新增回归测试 `src/term-protector.test.ts`（26 项，含修复前必失败的相邻场景）。
- **术语保护默认未生效（与文档不符）**：`cli.ts` 只有当用户传入 `--glossary-file` 或 `--term` 时（`hasTerms`）才把保护配置交给引擎，因此 `comment-translator ./src` 这类**默认调用完全不做保护**——标识符、URL、反引号代码块会照常被翻译/改写，与 README「默认开」的说明矛盾。次要影响：所有 `--no-protect-*` 开关都成了**静默空操作**（它们只写配置项、不触发保护器创建，导致整层保护处于关闭状态）。
  修复：CLI 改为**默认始终启用保护**（向引擎传入选项对象即可），`--no-protect-*` 现在真正按类别关闭；新增 `--no-protection` 作为彻底关闭的总开关，并补齐此前缺失的 `--no-protect-placeholders`。启动横幅新增 `Protect:` 一行显示当前保护状态。新增 E2E 回归测试 `src/test-protection-default.ts`（18 项，驱动真实 CLI 子进程；修复前 10 项失败）。
- **网络请求缺失超时，会无限挂起**：`GoogleTranslator.callApi` 与 `googleAuthAssertion`（服务账号 OAuth token 交换）使用裸 `fetch`，而 Node 内置 `fetch`（undici）**没有整体请求截止时间**（其 headers/body 超时默认 300s，对 CLI 等同于"永不超时"）。服务端只要「接受连接后不回应」，整个进程就会被永久卡住。DeepL 则完全依赖 SDK 默认值（10s），不受本项目控制。相比之下 LibreTranslate（30s）与 LLM 客户端（60s）各自内联实现了 `AbortController`，覆盖不一致。
  修复：新增共享模块 `src/fetch-timeout.ts`（`fetchWithTimeout` + `TimeoutError` + `isTimeoutError`），为**所有**出网调用提供统一硬截止时间（默认 30s）。LibreTranslate 与 LLM 客户端的内联实现改为复用该模块（消除重复）。DeepL 通过 `minTimeout` 接入同一超时值。超时错误会**在重试逻辑中按瞬时故障处理**（Google / LibreTranslate 均如此），而调用方主动取消（外部 signal / Ctrl-C）**不**被当作超时、不触发重试。新增 CLI 选项 `--timeout <ms>`（对 DeepL / Google / LibreTranslate 统一生效；旧的 `libreTranslateTimeout` 仍兼容）。
  新增回归测试 `src/test-timeout.ts`（26 项）：起一个「接受连接后不回应」的本地 HTTP 服务，逐一验证 helper、Google 翻译、Google OAuth 交换、LibreTranslate、LLM 客户端均在约定时间内报超时而非挂起；并断言快响应不受影响、主动取消不被误判、超时会被重试。对照实验：同一 stall 服务下，裸 `fetch` 4 秒仍未返回（被强制杀掉），`fetchWithTimeout(300ms)` 约 335ms 即报 `timed out after 300ms`。

### Changed
- `typescript` 从纯 devDependency 改为同时列入 **`optionalDependencies`**，用于 `.jsx` / `.tsx` 的精确注释提取。不安装不会破坏任何功能（仅 JSX 文本识别精度下降），因此不会强迫仅处理 `.ts/.js` 的用户承担其体积。

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
