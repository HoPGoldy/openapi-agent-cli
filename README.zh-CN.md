# oac - openapi agent cli

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> 轻量级 CLI 工具，从 OpenAPI 规范自动生成命令行接口。指向任意 OpenAPI 3.x 端点，即刻获得完整功能的命令行客户端。

[English](./README.md)

## 为什么需要它

不想再写 `curl` 命令和反复翻阅 API 文档？`oac` 读取 OpenAPI 规范，将每个接口自动转化为 CLI 命令，并提供完整的帮助信息 —— 包括参数类型、必填字段和 Body 结构。

专为 AI Coding Agent 设计 —— 详细的 `--help` 输出让 Agent 能准确理解并调用你的 API。

## 安装

```bash
npm install -g openapi-agent-cli
```

或使用 pnpm：

```bash
pnpm add -g openapi-agent-cli
```

**要求：** Node.js >= 18

## 快速开始

```bash
# 1. 添加服务
oac config add my-api --url http://localhost:3000 --openapi http://localhost:3000/docs/json

# 2. 查看可用命令
oac my-api --help

# 3. 调用接口
oac my-api post-api-users-search --body '{"keyword": "john", "page": 1}'
```

## 使用方式

### 服务管理

```bash
# 添加服务（远程 OpenAPI 规范）
oac config add petstore --url https://petstore.example.com --openapi https://petstore.example.com/v3/api-docs

# 添加服务（本地规范文件）
oac config add petstore --url https://petstore.example.com --openapi ./petstore.json

# 更新服务配置
oac config set petstore --url https://new-host.example.com

# 添加默认请求头（如认证 Token）
oac config set petstore --headers '{"Authorization": "Bearer token123"}'

# 列出所有服务
oac config list

# 刷新规范缓存
oac config refresh petstore   # 单个服务
oac config refresh             # 全部服务

# 删除服务
oac config remove petstore
```

### 调用接口

命令按 `{方法}-{路径}` 格式自动生成：

```
POST /api/diary/search  →  post-api-diary-search
GET  /api/items/{id}    →  get-api-items-id
```

```bash
# JSON Body
oac my-api post-api-diary-search --body '{"keyword": "旅行", "page": 1}'

# 路径参数
oac my-api get-api-items-id --params '{"id": "abc123"}'

# 查询参数
oac my-api get-api-files --query '{"format": "json", "limit": 10}'

# 自定义请求头
oac my-api get-api-data --header '{"X-Custom": "value"}'

# 文件上传（multipart）
oac my-api post-api-attachments-upload --body '{"file": "./path/to/photo.jpg", "description": "我的照片"}'

# 下载二进制文件
oac my-api get-api-files-download --query '{"fileId": "123"}' --output ./result.pdf

# 自定义超时
oac my-api post-api-slow-task --body '{}' --timeout 60000
```

### 丰富的帮助信息

每个命令都展示详细的 API 信息 —— 参数类型、必填字段、枚举值、嵌套结构：

```
$ oac my-api help post-api-diary-search

Usage: oac my-api post-api-diary-search [options]

搜索日记

Options:
  --body <json>    JSON request body
  --query <json>   URL query parameters as JSON
  --params <json>  Path parameters as JSON
  --header <json>  Custom request headers as JSON
  --output <file>  Save response to file (for binary downloads)
  --timeout <ms>   Request timeout in milliseconds (default: "30000")
  -h, --help       display help for command

API: POST /api/diary/search

Body Schema (--body):
  keyword           string        搜索关键词
  colors            string[]      颜色过滤
  desc              boolean       是否降序排列
  page              number        页码
  pageSize          number        每页数量
```

## 架构

```
OpenAPI 规范 (JSON/YAML)
       ↓
  spec-loader     →  获取并缓存规范（1 小时 TTL）
       ↓
  spec-parser     →  提取命令、参数、Body Schema
       ↓
  command-builder →  注册 CLI 命令并生成详细帮助文本
       ↓
  request         →  执行 HTTP 请求（JSON / multipart / 二进制）
```

| 模块                 | 功能                                           |
| -------------------- | ---------------------------------------------- |
| `config.ts`          | 读写 `~/.openapi-agent-cli/config.json`        |
| `config-commands.ts` | `oac config add/set/remove/list/refresh`       |
| `spec-loader.ts`     | 获取远程规范或读取本地文件，支持缓存           |
| `spec-parser.ts`     | 解析 OpenAPI 3.x → 扁平化命令 Schema           |
| `command-builder.ts` | 生成 Commander.js 子命令及详细帮助文本         |
| `request.ts`         | HTTP 客户端 — JSON、multipart 上传、二进制下载 |

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 监听模式
pnpm dev

# 运行测试
pnpm test

# 本地链接测试
pnpm link --global
```

## 许可证

[MIT](LICENSE)
