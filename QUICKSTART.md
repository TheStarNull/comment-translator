# LibreTranslate 快速开始

## 方式一：使用公共实例（零配置）

```bash
# 无需注册、无需 API Key
node dist/cli.js ./src --backend libretranslate --target zh -o ./out
```

## 方式二：Docker 自托管（推荐）

```bash
# 启动服务（默认 :5000）
docker run -d -p 5000:5000 libretranslate/libretranslate

# 使用本地服务
node dist/cli.js ./src --backend libretranslate --libre-url http://localhost:5000 --target zh
```

## 方式三：带 API Key 的公共实例

```bash
export LIBRETRANSLATE_API_KEY="your-key"
node dist/cli.js ./src --backend libretranslate --target en
```

## 配置项

| CLI 参数 | 环境变量 | 默认值 | 说明 |
|----------|---------|--------|------|
| `--libre-url` | `LIBRETRANSLATE_URL` | `https://libretranslate.com` | 服务地址 |
| `--libre-key` | `LIBRETRANSLATE_API_KEY` | (无) | API Key（部分实例需要） |
| `-t, --target` | - | `zh` | 目标语言（小写代码：zh/en/ja/ko/de/fr/es/ru） |
| `-s, --source` | - | auto-detect | 源语言 |

## 完整命令示例

```bash
# 翻译 Minecraft API d.ts 文件 → 英文
comment-translator ./minecraft-api --backend libretranslate \
  --libre-url http://localhost:5000 \
  --target en \
  -o ./minecraft-api-en \
  --glossary-file ./glossary.json
```
