# Comment Translator — Acode 插件

在 [Acode](https://acode.app) 里直接翻译 **JSDoc 与代码注释**，只改注释、**绝不改动代码**。

复用同一仓库 CLI 的核心逻辑（注释词法器、JSDoc 解析、术语保护），因此插件与命令行的行为完全一致，不会各修各的 bug。

---

## 功能

- **翻译当前文件注释** —— 命令面板执行，代码部分逐字不变
- **保存时自动翻译** —— 开关式，可随时关闭
- **术语保护** —— 标识符（`BlockPermutation` / `MAX_RETRY`）、URL、`` `code span` ``、`%s` 占位符保持原样
- **JSX/TSX 安全** —— `.tsx/.jsx` 能正确区分 JSX 文本里的 `//` 与真正的注释
- **`@example` 保护** —— 示例代码原样保留，不会被翻译成无法编译的内容

## 命令

| 命令 | 说明 |
|---|---|
| `Comment Translator: translate comments in the current file` | 翻译当前文件注释 |
| `Comment Translator: toggle translate-on-save` | 开关「保存时自动翻译」 |
| `Comment Translator: show current settings` | 显示当前设置 |

## 设置

设置页可配置：

- **Backend** —— 目前支持 `Mock`（离线、模拟）与 `LibreTranslate`
- **Target language** —— 目标语言，如 `zh`、`ja`
- **Translate on save** —— 保存时自动翻译
- **Protect code terms** —— 术语保护开关
- **LibreTranslate URL** —— 自托管实例地址

> ⚠️ **默认后端是 `Mock`**，输出为模拟内容且逐行带 `[zh] ` 标记。这样可以在**不配置任何密钥**的情况下跑通完整流程，同时**不可能**被误认为真实译文。要得到真实翻译，请把后端切到 LibreTranslate。

---

## 构建

```bash
cd plugins/acode-comment-translator
npm install
npm run build          # 产出 dist/main.js
npm test               # 42 项测试（含真实产物启动 + 命令端到端）
```

打包成可安装的分发文件：

```bash
npm run pack     # 产出 comment-translator.zip
```

> 用 `node pack.mjs` 而非 `zip` 命令，因为 `zip` 在原生 Termux 上通常没有安装。
> 归档使用固定时间戳，重复打包得到的文件**字节一致**，便于校验构建是否真的有变化。

然后在 Acode 中：**设置 → 插件 → 从文件安装**，选择 `comment-translator.zip`。

## 目录结构

```
plugins/acode-comment-translator/
├── plugin.json          # Acode 插件清单
├── icon.png
├── build.mjs            # esbuild 打包（产出单文件 IIFE）
├── build-test.mjs       # 测试打包（复用同一 @core 别名）
├── src/
│   ├── main.ts                    # 入口：命令注册 + 保存钩子
│   ├── settings.ts                # 设置持久化（localStorage）
│   └── core/
│       ├── backend.ts             # 后端工厂（Mock / LibreTranslate）
│       └── translate-source.ts    # 翻译一个文件中的全部注释
└── test/
    └── plugin.test.ts
```

`@core/*` 指向仓库根的 `src/`，即 CLI 的核心代码，**不复制、不 fork**。

---

## 已知限制

- **暂不支持 DeepL / Google**。CLI 通过 `deepl-node` SDK 访问 DeepL、用 Node `crypto` 签 Google 服务账号令牌，二者在 Acode 的 WebView 中都不存在。两者都可以改用纯 REST 实现，但那是独立改动，这里**不做假装支持**。
- **未安装 `typescript` 时**，`.tsx/.jsx` 会退回零依赖词法器，JSX 文本中的 `//`（如 `https://`）可能被误判。`.ts/.js/.mjs/.cjs` 不受影响。
- 术语表**文件**加载依赖 Node `fs`，在 WebView 中不可用；需要时可改用设置里的内联术语列表。
