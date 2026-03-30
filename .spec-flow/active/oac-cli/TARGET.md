# OpenAPI CLI 设计方案

基于 OpenAPI spec 动态生成命令的轻量级终端客户端，参考 restish 思路实现。

- **命令名**：`oac`（也可用完整名 `openapi-agent-cli`）
- **Node.js**：>= 18（需要原生 fetch、FormData、AbortSignal.timeout）

## 核心理念

CLI 本身不包含任何业务接口代码。连接服务后，从 `/docs/json` 拉取 OpenAPI spec，动态生成命令树。一个 CLI 可管理多个服务（如 diary、note、probe 等）。

## 使用示例

```bash
# 1. 添加服务配置（--openapi 可以是在线 URL 或本地文件）
oac config add diary \
  --url http://localhost:3499 \
  --openapi http://localhost:3499/docs/json \
  --headers '{"Authorization": "Bearer eyJhbG..."}'

oac config add note \
  --url https://note.example.com \
  --openapi ./note-openapi.json \
  --headers '{"Authorization": "Bearer eyJxyz..."}'

# 2. 查看已配置的服务
oac config list
# diary  http://localhost:3499      openapi: http://localhost:3499/docs/json (remote)
# note   https://note.example.com   openapi: ./note-openapi.json (local)

# 3. 更新配置（如更换 token）
oac config set diary --headers '{"Authorization": "Bearer eyJnew..."}'

# 4. 删除服务
oac config remove note

# 5. 未配置时使用 → 提示错误
oac diary post-api-diary-get-month-list --body '{"month":"202603"}'
# ✗ Service "diary" not configured. Run: oac config add diary --url <url> --openapi <url-or-file>

# 6. 正常调用（POST + JSON body）
oac diary post-api-diary-get-month-list --body '{"month":"202603"}'
# { "code": 200, "data": [{ "dateStr": "20260301", "content": "...", "color": null }] }

# 7. GET 请求带 query 参数
oac diary get-api-attachments-download --query '{"fileId":"abc123"}'

# 8. 文件上传（format: binary 字段自动识别为文件路径）
oac diary post-api-attachments-upload --body '{"file": "./path/to/photo.jpg"}'
# { "id": "abc123", "filename": "photo.jpg" }

# 文件 + 额外字段
oac diary post-api-attachments-upload --body '{"file": "./path/to/photo.jpg", "description": "旅行照片"}'

# 9. 查看可用命令（从 spec 动态生成）
oac diary --help
# Commands:
#   post-api-diary-get-month-list     获取指定月份的日记列表
#   post-api-diary-get-detail         获取日记详情
#   post-api-diary-update             更新日记
#   post-api-diary-search             搜索日记
#   post-api-diary-export             导出日记
#   post-api-attachments-upload       上传文件
#   get-api-attachments-request       请求文件
#   get-api-attachments-download      下载文件
#   post-api-auth-login               用户登录

# 10. 强制刷新 spec 缓存（仅对 --openapi 为在线 URL 的服务有效）
oac config refresh diary

# 刷新所有服务的 spec 缓存
oac config refresh

# 11. 文件下载（二进制响应自动保存到文件）
oac diary get-api-attachments-download --query '{"fileId":"abc123"}' --output ./photo.jpg
# ✓ Saved to ./photo.jpg (128.5 KB)

# 未指定 --output 时，从 Content-Disposition 取文件名或自动命名
oac diary get-api-attachments-download --query '{"fileId":"abc123"}'
# ✓ Saved to ./abc123.jpg (128.5 KB)
```

## 架构设计

```
oac (入口，也可用 openapi-agent-cli)
 ├── config (配置与维护)
 │   ├── add <name> --url --openapi --headers   # 添加服务
 │   ├── set <name> --url/--openapi/--headers   # 更新服务配置（partial merge）
 │   ├── remove <name>                          # 删除服务
 │   ├── list                                   # 查看已配置服务
 │   └── refresh [name]                         # 刷新 spec 缓存（仅限在线 URL）
 └── <service-name> (动态命令，来自 OpenAPI spec)
     └── <action> [--body <json>] [--query <json>] [--params <json>] [--header <json>] [--output <file>] [--timeout <ms>]
```

### 目录结构

```
openapi-agent-cli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts           # 入口，commander 初始化
│   ├── config.ts          # 配置管理（读写 ~/.config/openapi-agent-cli/）
│   ├── spec-loader.ts     # 拉取 OpenAPI spec（远程/本地）
│   ├── spec-parser.ts     # 解析 spec → 生成 schema.json
│   ├── command-builder.ts # 读取 schema.json → 注册 commander 命令
│   └── request.ts         # HTTP 请求封装（JSON / multipart / binary 响应）
└── __tests__/
    ├── spec-parser.test.ts
    ├── command-builder.test.ts
    └── cli.integration.test.ts
```

### 配置文件

路径：`~/.config/openapi-agent-cli/config.json`

```json
{
  "services": {
    "diary": {
      "url": "http://localhost:3499",
      "openapi": "http://localhost:3499/docs/json",
      "headers": {
        "Authorization": "Bearer eyJhbG..."
      }
    },
    "note": {
      "url": "https://note.example.com",
      "openapi": "./note-openapi.json",
      "headers": {
        "Authorization": "Bearer eyJxyz...",
        "X-Custom": "value"
      }
    }
  }
}
```

### Spec 来源

`openapi` 字段支持两种来源：

| 类型     | 示例                                      | 缓存机制                           |
| -------- | ----------------------------------------- | ---------------------------------- |
| 在线 URL | `http://localhost:3499/docs/json`         | 缓存 1 小时，支持 `config refresh` |
| 本地文件 | `./note-openapi.json` 或 `/abs/path.json` | 每次直接读取，无缓存               |

### 缓存结构

路径：`~/.config/openapi-agent-cli/cache/`

```
cache/
├── diary.spec.json      # 原始 OpenAPI spec（仅远程 URL 才缓存）
└── diary.schema.json    # 解析后的命令 schema（所有服务都有）
```

**spec.json**（原始 spec 缓存，仅远程 URL）：

```json
{
  "fetchedAt": 1711526400000,
  "spec": { "openapi": "3.0.0", "paths": { ... } }
}
```

**schema.json**（解析后的命令定义，command-builder 直接消费）：

```json
{
  "generatedAt": 1711526400000,
  "commands": [
    {
      "name": "post-api-diary-get-month-list",
      "description": "获取指定月份的日记列表",
      "method": "POST",
      "path": "/api/diary/getMonthList",
      "contentType": "application/json",
      "binaryFields": []
    },
    {
      "name": "post-api-attachments-upload",
      "description": "上传文件",
      "method": "POST",
      "path": "/api/attachments/upload",
      "contentType": "multipart/form-data",
      "binaryFields": ["file"]
    }
  ]
}
```

**数据流**：

```
config add / config refresh
  → 拉取 OpenAPI spec（远程 URL 或本地文件）
  → spec-parser 解析 spec → 写入 schema.json
  → 远程 URL 同时缓存 spec.json（1 小时有效）

执行命令时
  → command-builder 直接读取 schema.json → 注册子命令
  → 无需再解析 spec
```

远程 spec 默认缓存 1 小时，`config refresh` 强制刷新。本地文件每次 `config add` / `config refresh` 时重新读取并生成 schema.json。

## 核心模块设计

### 1. config.ts — 配置管理

```typescript
const CONFIG_DIR = join(homedir(), ".config", "openapi-agent-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ServiceConfig {
  url: string; // API 基地址
  openapi: string; // OpenAPI spec 来源（URL 或本地文件路径）
  headers?: Record<string, string>; // 通用请求头，附加到该服务的所有 API 调用
}

interface AppConfig {
  services: Record<string, ServiceConfig>;
}

export function loadConfig(): AppConfig;
export function saveConfig(config: AppConfig): void;
export function getService(name: string): ServiceConfig | undefined;
export function addService(name: string, config: ServiceConfig): void;
export function updateService(name: string, partial: Partial<ServiceConfig>): void; // partial merge
export function removeService(name: string): void;
```

### 2. spec-loader.ts — Spec 拉取

从远程 URL 或本地文件获取原始 spec，通过 `@apidevtools/swagger-parser` 处理 `$ref` 解析和 Swagger 2.0/OpenAPI 3.x 多格式兼容。

> **本地文件路径解析**：`--openapi ./note-openapi.json` 中的相对路径基于执行 `config add` 时的 CWD 解析，存储时转为绝对路径，避免换目录后找不到文件。

```typescript
import SwaggerParser from "@apidevtools/swagger-parser";

const CACHE_DIR = join(CONFIG_DIR, "cache");
const CACHE_TTL = 60 * 60 * 1000; // 1 小时

export async function fetchSpec(
  serviceName: string,
  serviceConfig: ServiceConfig,
  forceRefresh?: boolean,
): Promise<OpenAPISpec> {
  const { openapi } = serviceConfig;
  const isRemote = openapi.startsWith("http://") || openapi.startsWith("https://");

  // 本地文件 → 直接读取
  if (!isRemote) {
    const spec = await SwaggerParser.dereference(resolve(openapi));
    return spec as OpenAPISpec;
  }

  // 在线 URL → 带缓存
  const cachePath = join(CACHE_DIR, `${serviceName}.spec.json`);

  if (!forceRefresh && isCacheValid(cachePath, CACHE_TTL)) {
    return readCache(cachePath);
  }

  const res = await fetch(openapi, {
    headers: serviceConfig.headers,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch spec from ${openapi}: ${res.status}`);
  }

  const rawSpec = await res.json();
  // 解析 $ref、兼容 Swagger 2.0 / OpenAPI 3.x
  const spec = await SwaggerParser.dereference(rawSpec);
  writeCache(cachePath, spec);

  return spec as OpenAPISpec;
}
```

### 3. spec-parser.ts — Spec 解析

将已解析的 OpenAPI spec（`$ref` 已展开）转换为扁平的 schema.json，供 command-builder 消费。多格式兼容由 spec-loader 中的 `swagger-parser` 处理，此处只需遍历统一后的 OpenAPI 3.x 结构。

```typescript
interface CommandSchema {
  name: string; // post-api-diary-get-month-list
  description: string; // 从 operation.description 或 summary 取
  method: string; // POST
  path: string; // /api/diary/getMonthList（原始路径，含 {param}）
  contentType: string; // application/json | multipart/form-data
  binaryFields: string[]; // format:binary 字段名列表
}

interface ServiceSchema {
  generatedAt: number;
  commands: CommandSchema[];
}

const SCHEMA_DIR = join(CONFIG_DIR, "cache");

/** 解析 spec → schema.json 并写入缓存 */
export function parseAndSave(serviceName: string, spec: OpenAPISpec): ServiceSchema {
  const commands: CommandSchema[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!isOperation(operation)) continue;

      const contentType = getContentType(operation);
      const binaryFields = contentType === "multipart/form-data" ? extractBinaryFields(operation) : [];

      commands.push({
        name: `${method}-${pathToCommandName(path)}`,
        description: operation.description ?? operation.summary ?? "",
        method: method.toUpperCase(),
        path,
        contentType,
        binaryFields,
      });
    }
  }

  // 命令名冲突检测（理论上不会发生，因为路径参数也参与命名，但仍做防御性检查）
  const nameSet = new Set<string>();
  for (const cmd of commands) {
    if (nameSet.has(cmd.name)) {
      throw new Error(`Command name collision: "${cmd.name}" (path: ${cmd.path})`);
    }
    nameSet.add(cmd.name);
  }

  const schema: ServiceSchema = { generatedAt: Date.now(), commands };
  const schemaPath = join(SCHEMA_DIR, `${serviceName}.schema.json`);
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2));

  return schema;
}

/** 读取已缓存的 schema.json */
export function loadSchema(serviceName: string): ServiceSchema | null {
  const schemaPath = join(SCHEMA_DIR, `${serviceName}.schema.json`);
  if (!existsSync(schemaPath)) return null;
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}

/** 路径 → 命令名
 *  /api/diary/getMonthList → api-diary-get-month-list
 *  /api/items/{id} → api-items-id
 */
function pathToCommandName(path: string): string {
  return path
    .replace(/^\//, "")
    .split("/")
    .map((seg) => seg.replace(/[{}]/g, "")) // {id} → id
    .map((seg) => camelToKebab(seg))
    .join("-");
}

/** camelCase → kebab-case
 *  getMonthList → get-month-list
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function getContentType(operation: OpenAPIOperation): string {
  const content = operation.requestBody?.content;
  if (content?.["multipart/form-data"]) return "multipart/form-data";
  return "application/json";
}

function extractBinaryFields(operation: OpenAPIOperation): string[] {
  const schema = operation.requestBody?.content?.["multipart/form-data"]?.schema;
  if (!schema?.properties) return [];
  return Object.entries(schema.properties)
    .filter(([, prop]) => prop.format === "binary")
    .map(([name]) => name);
}
```

### 4. command-builder.ts — 动态命令生成

读取 schema.json 注册 commander 命令。不接触 OpenAPI spec，逻辑极简。

核心转换逻辑：

```
OpenAPI Path: POST /api/diary/getMonthList
  → 命令名: post-api-diary-get-month-list

  method 转小写作为前缀 → post-
  去掉前导 / → api/diary/getMonthList
  路径参数去花括号 {id} → id
  各段 camelCase → kebab-case，用 - 拼接
```

**路径 → 命令名映射示例**：

| OpenAPI Path                            | 命令名                                |
| --------------------------------------- | ------------------------------------- |
| `POST /api/diary/getMonthList`          | `post-api-diary-get-month-list`       |
| `POST /api/diary/update`                | `post-api-diary-update`               |
| `POST /api/attachments/upload`          | `post-api-attachments-upload`         |
| `GET /api/attachments/request/{fileId}` | `get-api-attachments-request-file-id` |
| `GET /api/attachments/download`         | `get-api-attachments-download`        |
| `POST /api/auth/login`                  | `post-api-auth-login`                 |
| `GET /api/v2/users/list`                | `get-api-v2-users-list`               |

每个子命令的入参：

| 选项              | 类型   | 用途                                    | 示例                                |
| ----------------- | ------ | --------------------------------------- | ----------------------------------- |
| `--body <json>`   | JSON   | 请求体（JSON 或含文件路径）             | `--body '{"month":"202603"}'`       |
| `--query <json>`  | JSON   | URL query 参数                          | `--query '{"page":1}'`              |
| `--params <json>` | JSON   | 路径参数，替换 URL 中的 `{placeholder}` | `--params '{"id":"abc123"}'`        |
| `--header <json>` | JSON   | 自定义请求头                            | `--header '{"X-Request-Id":"xxx"}'` |
| `--output <file>` | string | 将响应保存到文件（二进制下载用）        | `--output ./photo.jpg`              |
| `--timeout <ms>`  | number | 请求超时毫秒数（默认 30000）            | `--timeout 60000`                   |

**文件上传处理**：schema.json 中的 `binaryFields` 标记了哪些字段是文件，command-builder 据此将 `--body` 中对应值视为本地文件路径，自动构建 `FormData` 上传。

```typescript
function safeJsonParse(value: string | undefined, flag: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (e) {
    console.error(`✗ Invalid JSON in ${flag}: ${(e as Error).message}`);
    process.exit(1);
  }
}

export function buildCommands(group: Command, schema: ServiceSchema, serviceConfig: ServiceConfig): void {
  for (const cmd of schema.commands) {
    const sub = group.command(cmd.name).description(cmd.description);

    sub.option("--body <json>", "JSON request body");
    sub.option("--query <json>", "URL query parameters as JSON");
    sub.option("--params <json>", "Path parameters as JSON");
    sub.option("--header <json>", "Custom request headers as JSON");
    sub.option("--output <file>", "Save response to file (for binary downloads)");
    sub.option("--timeout <ms>", "Request timeout in milliseconds", "30000");

    sub.action(async (opts) => {
      const query = safeJsonParse(opts.query, "--query");
      const body = safeJsonParse(opts.body, "--body");
      const params = safeJsonParse(opts.params, "--params");
      const headers = safeJsonParse(opts.header, "--header");
      const timeout = Number(opts.timeout);
      const output = opts.output;

      // 替换路径参数: /api/diary/{id} + {id: "abc"} → /api/diary/abc
      const resolvedPath = params
        ? cmd.path.replace(/\{(\w+)\}/g, (_, key) => {
            if (!(key in params)) throw new Error(`Missing path param: ${key}`);
            return encodeURIComponent(String(params[key]));
          })
        : cmd.path;

      const isMultipart = cmd.contentType === "multipart/form-data";

      if (isMultipart && body) {
        const binaryFields = new Set(cmd.binaryFields);
        const result = await apiUpload(
          serviceConfig,
          resolvedPath,
          body,
          binaryFields,
          query,
          headers,
          timeout,
        );
        console.log(JSON.stringify(result, null, 2));
      } else {
        const result = await apiRequest(
          serviceConfig,
          cmd.method,
          resolvedPath,
          body,
          query,
          headers,
          timeout,
          output,
        );
        if (result !== null) {
          console.log(JSON.stringify(result, null, 2));
        }
      }
    });
  }
}
```

### 5. request.ts — HTTP 请求

```typescript
/** JSON 请求（支持二进制响应自动检测）
 *  - Content-Type: application/json → 解析 JSON 并返回
 *  - Content-Type: text/* → 打印文本并返回
 *  - 其他 → 视为二进制，保存到 output 文件（或从 Content-Disposition 取文件名）
 */
export async function apiRequest(
  config: ServiceConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
  output?: string,
): Promise<unknown | null> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
      ...customHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  const contentType = res.headers.get("content-type") ?? "";

  // 二进制响应 → 保存到文件
  if (!contentType.includes("application/json") && !contentType.startsWith("text/")) {
    const savePath = output ?? getFilenameFromResponse(res) ?? "download";
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(savePath, buffer);
    const sizeKB = (buffer.byteLength / 1024).toFixed(1);
    console.log(`✓ Saved to ${savePath} (${sizeKB} KB)`);
    return null;
  }

  // 文本响应
  if (contentType.startsWith("text/") && !contentType.includes("application/json")) {
    const text = await res.text();
    console.log(text);
    return null;
  }

  // JSON 响应
  return await res.json();
}

/** 从 Content-Disposition header 提取文件名 */
function getFilenameFromResponse(res: Response): string | null {
  const disposition = res.headers.get("content-disposition");
  if (!disposition) return null;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\s]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** 文件上传（multipart/form-data）
 *  binaryFields: 从 spec 识别出的 format:binary 字段名集合
 *  body 中属于 binaryFields 的值视为文件路径，其余作为普通表单字段
 */
export async function apiUpload(
  config: ServiceConfig,
  path: string,
  body: Record<string, unknown>,
  binaryFields: Set<string>,
  query?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  timeout = 30000,
): Promise<unknown> {
  const url = new URL(`${config.url}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const formData = new FormData();

  for (const [k, v] of Object.entries(body)) {
    if (binaryFields.has(k)) {
      // format:binary → 读取本地文件
      const filePath = String(v);
      const file = new Blob([await readFile(filePath)]);
      formData.append(k, file, basename(filePath));
    } else {
      // 普通字段
      formData.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { ...config.headers, ...customHeaders },
    body: formData,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ [${res.status}] ${text}`);
    process.exit(1);
  }

  return await res.json();
}
```

### 6. index.ts — 入口

**即时解析 + 启动注册**：`config add` 时立即拉取 spec 并生成 schema.json，启动时读取所有 schema.json 直接注册子命令（无需懒加载，JSON 文件读取开销可忽略）。

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command().name("oac").version("1.0.0").description("OpenAPI-driven CLI for services");

// 1. 注册内置 config 命令
//    config add 时: fetchSpec → parseAndSave → schema.json
//    config refresh 时: 同上，强制刷新
registerConfigCommands(program);

// 2. 为每个已配置服务直接注册子命令（读 schema.json，开销 < 1ms）
const config = loadConfig();

for (const [name, serviceConfig] of Object.entries(config.services)) {
  const schema = loadSchema(name);

  if (!schema) {
    // schema 缺失时注册提示命令
    program
      .command(name)
      .description(`${name} service (schema missing)`)
      .action(() => {
        console.error(`✗ Schema not found. Run: oac config refresh ${name}`);
        process.exit(1);
      });
    continue;
  }

  const group = program.command(name).description(`${name} service`);
  buildCommands(group, schema, serviceConfig);
}

program.parse();
```

**`config add` 内部流程**：

```typescript
async function handleConfigAdd(name: string, opts: ConfigAddOpts) {
  // 0. 检查服务名是否已存在
  if (getService(name)) {
    console.error(
      `✗ Service "${name}" already exists. Use: oac config set ${name} --url/--openapi/--headers`,
    );
    process.exit(1);
  }

  const serviceConfig = {
    url: opts.url,
    openapi: opts.openapi,
    headers: opts.headers,
  };

  // 1. 立即拉取 spec（失败则报错，不写入配置）
  const spec = await fetchSpec(name, serviceConfig);

  // 2. 解析 spec → 生成 schema.json
  const schema = parseAndSave(name, spec);
  console.log(`✓ Parsed ${schema.commands.length} commands from spec`);

  // 3. 写入配置
  addService(name, serviceConfig);
  console.log(`✓ Service "${name}" added`);
}
```

**`config set` 内部流程**：

```typescript
async function handleConfigSet(name: string, opts: ConfigSetOpts) {
  const existing = getService(name);
  if (!existing) {
    console.error(
      `✗ Service "${name}" not found. Use: oac config add ${name} --url <url> --openapi <url-or-file>`,
    );
    process.exit(1);
  }

  const partial: Partial<ServiceConfig> = {};
  if (opts.url) partial.url = opts.url;
  if (opts.openapi) partial.openapi = opts.openapi;
  if (opts.headers) partial.headers = JSON.parse(opts.headers);

  // partial merge 更新配置
  updateService(name, partial);
  const updated = getService(name)!;

  // --openapi 变更时自动重新拉取 spec 并生成 schema.json
  if (opts.openapi) {
    const spec = await fetchSpec(name, updated, true);
    const schema = parseAndSave(name, spec);
    console.log(`✓ Re-parsed ${schema.commands.length} commands from new spec`);
  }

  console.log(`✓ Service "${name}" updated`);
}
```

## 输出规则

根据响应 `Content-Type` 自动判断输出方式：

| Content-Type       | 行为                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `application/json` | 解析 JSON 并打印到 stdout                                                                       |
| `text/*`           | 直接打印文本到 stdout                                                                           |
| 其他（二进制）     | 保存到 `--output` 指定路径；未指定时从 `Content-Disposition` 取文件名，再兜底用 `download` 命名 |

通用规则：

- 成功时：stdout 输出响应内容（JSON / 文本），或打印保存文件路径 `✓ Saved to ./photo.jpg (128.5 KB)`
- 失败时：stderr 打印 HTTP 状态码和响应内容 `✗ [status] body`，退出码 1
- 管道友好：`oac diary post-api-diary-export --body '{}' | jq '.data[]'`

## 技术选型

| 依赖                          | 用途          | 备注                                       |
| ----------------------------- | ------------- | ------------------------------------------ |
| `commander`                   | 命令行框架    | 支持动态注册子命令                         |
| `@apidevtools/swagger-parser` | Spec 解析     | `$ref` 展开 + Swagger 2.0/OpenAPI 3.x 兼容 |
| Node 内置 `fetch`             | HTTP 请求     | Node 18+ 原生，零依赖                      |
| Node 内置 `fs`                | 配置/缓存读写 | 零依赖                                     |
| `chalk`（可选）               | 彩色输出      | 美化错误和状态信息                         |
| `tsup`                        | 构建打包      | 基于 esbuild，零配置 TS CLI 打包           |
| `vitest`                      | 单元/集成测试 | devDependency                              |
| `execa`                       | CLI 集成测试  | devDependency                              |

零外部重依赖，打包后体积极小。

## 安装方式

```bash
# 开发
pnpm install && pnpm build

# 全局安装
npm install -g openapi-agent-cli
```

## 构建与发布

使用 `tsup` 单文件打包，零配置、自动处理 shebang。

**package.json 核心字段：**

```json
{
  "name": "openapi-agent-cli",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "oac": "./dist/index.js",
    "openapi-agent-cli": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "@apidevtools/swagger-parser": "^10.0.0",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "execa": "^9.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

**tsup.config.ts：**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  minify: true,
});
```

**发布流程：**

```bash
pnpm build
npm publish
```

## 测试策略

分两层测试，使用 **vitest**。

**选型理由**：

- 原生 ESM 支持，与项目 `"type": "module"` 一致，无需额外配置
- 兼容 Jest API（`describe`/`it`/`expect`），迁移成本为零
- 基于 Vite 的 HMR 能力，watch 模式极快
- 内置 TypeScript 支持，无需 `ts-jest` 等额外转译层
- 集成测试配合 `execa` 调用编译后的 CLI 二进制，验证端到端行为

### 单元测试

针对纯函数和核心逻辑，不依赖网络和文件系统。

```typescript
// __tests__/spec-parser.test.ts
import { describe, it, expect } from "vitest";

describe("spec-parser", () => {
  it("should parse paths to command schema", () => {
    const spec = {
      openapi: "3.0.0",
      paths: {
        "/api/diary/getMonthList": {
          post: { description: "获取月份列表" },
        },
        "/api/attachments/upload": {
          post: {
            description: "上传文件",
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: {
                    properties: { file: { type: "string", format: "binary" } },
                  },
                },
              },
            },
          },
        },
      },
    };

    const schema = parseSpec(spec);

    expect(schema.commands).toHaveLength(2);
    expect(schema.commands[0]).toMatchObject({
      name: "post-api-diary-get-month-list",
      method: "POST",
      path: "/api/diary/getMonthList",
      contentType: "application/json",
      binaryFields: [],
    });
    expect(schema.commands[1]).toMatchObject({
      name: "post-api-attachments-upload",
      contentType: "multipart/form-data",
      binaryFields: ["file"],
    });
  });
});

// __tests__/command-builder.test.ts
describe("command-builder", () => {
  it("should register commands from schema", () => {
    const { Command } = await import("commander");
    const group = new Command("test");
    const schema = {
      generatedAt: Date.now(),
      commands: [
        {
          name: "post-api-diary-update",
          description: "更新日记",
          method: "POST",
          path: "/api/diary/update",
          contentType: "application/json",
          binaryFields: [],
        },
      ],
    };

    buildCommands(group, schema, { url: "http://localhost:3499", openapi: "" });

    const names = group.commands.map((c) => c.name());
    expect(names).toContain("post-api-diary-update");
  });
});
```

### 集成测试

用 `execa` 执行编译后的 CLI 二进制，验证端到端行为。使用本地 fixture spec 文件，不依赖网络。

```typescript
// __tests__/cli.integration.test.ts
import { execaNode } from "execa";
import { beforeAll } from "vitest";

const CLI = "./dist/index.js";
const FIXTURE_SPEC = "./__tests__/fixtures/test-spec.json";

beforeAll(async () => {
  // 添加测试服务（使用本地 spec 文件）
  await execaNode(CLI, [
    "config",
    "add",
    "test-svc",
    "--url",
    "http://localhost:9999",
    "--openapi",
    FIXTURE_SPEC,
  ]);
});

it("should show commands in help", async () => {
  const { stdout } = await execaNode(CLI, ["test-svc", "--help"]);
  expect(stdout).toContain("post-api-diary-get-month-list");
  expect(stdout).toContain("获取月份列表");
});

it("should fail for unknown service", async () => {
  const result = await execaNode(CLI, ["unknown-svc", "some-cmd"], {
    reject: false,
  });
  expect(result.exitCode).toBe(1);
});
```

## 未来扩展

- **Shell 自动补全**：commander 支持生成补全脚本，结合缓存的 spec 实现动态补全
- **交互模式**：`oac diary --interactive`，用 prompts 引导填写参数
- **Token 自动刷新**：检测到 401 时自动调用 login 接口刷新 token
