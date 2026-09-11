# Comment Translator 🌐

一个专门翻译 **JSDoc** 和代码注释的工具，支持 **JavaScript / TypeScript**（含 `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`），通过 **Google Translate API** 进行翻译，输出翻译后的文件。

## ✨ 功能特性

- 🔍 **智能解析** — 精确提取 JSDoc、块注释、行注释
- 🏷️ **JSDoc 感知** — 识别 `@param` `@returns` `@example` 等标签，只翻译描述部分，保留类型与参数名
- 📦 **批量翻译** — 自动合并文本进行批量 API 调用，提高效率
- 🌍 **多语言支持** — 支持 Google Translate 的所有语言（zh, en, ja, ko, es...）
- 📁 **目录递归** — 支持单文件或整个目录批量处理
- 🎯 **格式保持** — 翻译后保持原始缩进、星号前缀等格式
- 🧪 **Mock 模式** — 内置模拟翻译器，无需 API Key 即可测试

## 📦 安装

```bash
cd comment-translator
npm install
npm run build
```

## 🚀 快速使用

### 方式一：使用真实 Google API

```bash
# 使用 API Key（最简单）
node dist/cli.js ./src --api-key YOUR_API_KEY --target zh -o ./output

# 使用 Service Account 密钥文件
node dist/cli.js ./src --key-file ./gcloud-key.json --target ja -o ./output

# 使用 Project ID（需要已配置 ADC）
node dist/cli.js ./src --project-id my-project --target en -o ./output
```

### 方式二：使用 Mock 模式（无需 API Key）

```bash
# 运行演示（使用模拟翻译器）
npm run build && node dist/test-demo.js
```

## 📝 命令行参数

```
Options:
  -o, --output <path>       输出目录或文件路径
  -t, --target <lang>       目标语言代码 (默认: "zh")
  -s, --source <lang>       源语言代码 (可选, 默认自动检测)
  -p, --project-id <id>     Google Cloud 项目 ID
  -k, --key-file <path>     Service Account 密钥文件路径 (JSON)
  --api-key <key>           Google API Key
  --client-type <type>      API 版本: "v2" 或 "v3" (默认: "v2")
  --location <location>     v3 API 位置 (默认: "global")
  --extensions <exts>       文件扩展名 (默认: ".js,.ts,.jsx,.tsx,.mjs,.cjs,.d.ts")
  --no-recursive            禁用递归目录遍历
  --dry-run                 预览模式, 不写入文件
  -v, --verbose             详细输出
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
 * @returns 新的用户对象
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
│   ├── translator.ts       # Google Translate API 封装 (v2/v3)
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

## 🔧 Google API 配置

1. 创建 Google Cloud 项目
2. 启用 **Cloud Translation API**
3. 创建凭证（API Key 或 Service Account）
4. 通过命令行参数或环境变量传入

环境变量方式：
```bash
export GOOGLE_API_KEY="your-api-key"
# 或
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

## 📄 License

MIT