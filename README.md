# oac - OpenAPI Agent CLI

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> A lightweight CLI that dynamically generates commands from OpenAPI specs. Point it at any OpenAPI 3.x endpoint and get a fully functional command-line client — instantly.

[中文文档](./README.zh-CN.md)

## Why

Tired of writing `curl` commands and looking up API docs? `oac` reads your OpenAPI spec and turns every endpoint into a CLI command with full help text, including parameter types, required fields, and body schema.

Built to work seamlessly with AI coding agents — the detailed `--help` output gives agents everything they need to call your APIs correctly.

## Install

```bash
npm install -g openapi-agent-cli
```

Or with pnpm:

```bash
pnpm add -g openapi-agent-cli
```

**Requirements:** Node.js >= 18

## Quick Start

```bash
# 1. Add a service
oac config add my-api --url http://localhost:3000 --openapi http://localhost:3000/docs/json

# 2. List available commands
oac my-api --help

# 3. Call an endpoint
oac my-api post-api-users-search --body '{"keyword": "john", "page": 1}'
```

## Usage

### Managing Services

```bash
# Add a service (remote OpenAPI spec)
oac config add petstore --url https://petstore.example.com --openapi https://petstore.example.com/v3/api-docs

# Add a service (local spec file)
oac config add petstore --url https://petstore.example.com --openapi ./petstore.json

# Update service config
oac config set petstore --url https://new-host.example.com

# Add default headers (e.g. auth tokens)
oac config set petstore --headers '{"Authorization": "Bearer token123"}'

# List all services
oac config list

# Refresh spec cache
oac config refresh petstore   # single service
oac config refresh             # all services

# Remove a service
oac config remove petstore
```

### Calling APIs

Commands are auto-generated in the format `{method}-{path}`:

```
POST /api/diary/search  →  post-api-diary-search
GET  /api/items/{id}    →  get-api-items-id
```

```bash
# JSON body
oac my-api post-api-diary-search --body '{"keyword": "travel", "page": 1}'

# Path parameters
oac my-api get-api-items-id --params '{"id": "abc123"}'

# Query parameters
oac my-api get-api-files --query '{"format": "json", "limit": 10}'

# Custom headers
oac my-api get-api-data --header '{"X-Custom": "value"}'

# File upload (multipart)
oac my-api post-api-attachments-upload --body '{"file": "./photo.jpg", "description": "My photo"}'

# Download binary to file
oac my-api get-api-files-download --query '{"fileId": "123"}' --output ./result.pdf

# Custom timeout
oac my-api post-api-slow-task --body '{}' --timeout 60000
```

### Rich Help Text

Every command shows detailed API info — parameter types, required fields, enums, and nested schemas:

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

## Architecture

```
OpenAPI Spec (JSON/YAML)
       ↓
  spec-loader     →  fetch & cache spec (1-hour TTL)
       ↓
  spec-parser     →  extract commands, params, body schemas
       ↓
  command-builder →  register CLI commands with rich help
       ↓
  request         →  execute HTTP requests (JSON / multipart / binary)
```

| Module               | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `config.ts`          | Read/write `~/.openapi-agent-cli/config.json`           |
| `config-commands.ts` | `oac config add/set/remove/list/refresh`                |
| `spec-loader.ts`     | Fetch remote specs or read local files, with caching    |
| `spec-parser.ts`     | Parse OpenAPI 3.x → flat command schemas                |
| `command-builder.ts` | Generate Commander.js subcommands with detailed help    |
| `request.ts`         | HTTP client — JSON, multipart uploads, binary downloads |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Link for local testing
pnpm link --global
```

## License

[MIT](LICENSE)
