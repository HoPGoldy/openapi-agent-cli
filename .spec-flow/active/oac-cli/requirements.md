# OAC CLI — 需求

> **状态**: 已批准
> **提案**: [proposal.md](./proposal.md)
> **最后更新**: 2026-03-27

## 概述

基于 OpenAPI spec 动态生成 CLI 命令的终端工具，支持多服务配置管理、JSON/文件上传/二进制下载请求。

## 功能需求

### 配置管理

- **FR-001**: 当用户执行 `oac config add <name> --url <url> --openapi <spec> [--headers <json>]` 时，系统应拉取 spec、生成 schema.json、写入配置。
- **FR-002**: 当用户对已存在的服务名执行 `config add` 时，系统应报错并提示使用 `config set`。
- **FR-003**: 当用户执行 `oac config set <name> --url/--openapi/--headers` 时，系统应 partial merge 更新配置。
- **FR-004**: 当 `config set` 涉及 `--openapi` 变更时，系统应自动重新拉取 spec 并生成新的 schema.json。
- **FR-005**: 当用户执行 `oac config remove <name>` 时，系统应删除该服务配置。
- **FR-006**: 当用户执行 `oac config list` 时，系统应列出所有已配置服务及其 URL、spec 来源类型（remote/local）。
- **FR-007**: 当用户执行 `oac config refresh [name]` 时，系统应强制重新拉取 spec 并重新生成 schema.json。不指定 name 时刷新所有服务。
- **FR-008**: `--openapi` 中的本地相对路径应基于执行命令时的 CWD 解析，存储时转为绝对路径。

### Spec 加载

- **FR-010**: 系统应支持从 HTTP/HTTPS URL 拉取 OpenAPI spec。
- **FR-011**: 系统应支持从本地文件路径读取 OpenAPI spec。
- **FR-012**: 对于远程 URL spec，系统应缓存 1 小时，缓存文件为 `~/.config/openapi-agent-cli/cache/<name>.spec.json`。
- **FR-013**: 系统应通过 `@apidevtools/swagger-parser` 解析 `$ref` 引用并兼容 Swagger 2.0 / OpenAPI 3.x。
- **FR-014**: 拉取远程 spec 时应附带服务配置中的 headers（用于需要认证的 spec 端点）。

### Spec 解析

- **FR-020**: 系统应遍历 spec 的 `paths` 字段，为每个 operation 生成一条 CommandSchema 记录。
- **FR-021**: 命令名格式为 `{method}-{path-kebab}`，其中路径各段 camelCase 转 kebab-case，路径参数去花括号保留。
- **FR-022**: 系统应识别 `requestBody.content["multipart/form-data"]` 类型，提取 `format: "binary"` 字段列表到 `binaryFields`。
- **FR-023**: 系统应从 `operation.description` 或 `operation.summary` 提取命令描述。
- **FR-024**: 系统应检测命令名冲突，发现重名时抛出错误。
- **FR-025**: 解析结果写入 `~/.config/openapi-agent-cli/cache/<name>.schema.json`。

### 动态命令执行

- **FR-030**: CLI 启动时应读取所有已配置服务的 schema.json 并注册 commander 子命令。
- **FR-031**: 每个子命令应支持 `--body <json>`、`--query <json>`、`--params <json>`、`--header <json>`、`--output <file>`、`--timeout <ms>` 选项。
- **FR-032**: `--params` 中的值应替换路径中的 `{placeholder}`，缺失参数时报错。
- **FR-033**: 当 `--body`/`--query`/`--params`/`--header` 的 JSON 格式错误时，系统应输出 `✗ Invalid JSON in <flag>: <message>` 并退出。
- **FR-034**: 当 schema.json 缺失时，系统应提示用户执行 `oac config refresh <name>`。

### HTTP 请求

- **FR-040**: 对于 `application/json` contentType，系统应发送 JSON body 请求。
- **FR-041**: 对于 `multipart/form-data` contentType，系统应构建 FormData；`binaryFields` 中的字段值视为本地文件路径读取。
- **FR-042**: 系统应将服务配置中的 headers 附加到所有请求。
- **FR-043**: `--header` 中的自定义 header 应覆盖配置中的同名 header。
- **FR-044**: 超时默认 30000ms，可通过 `--timeout` 覆盖。

### 响应处理

- **FR-050**: `Content-Type: application/json` 响应应解析为 JSON 并打印到 stdout。
- **FR-051**: `Content-Type: text/*` 响应应直接打印文本到 stdout。
- **FR-052**: 其他 Content-Type 响应视为二进制，保存到 `--output` 指定路径。
- **FR-053**: 二进制响应未指定 `--output` 时，从 `Content-Disposition` header 提取文件名，兜底用 `download` 命名。
- **FR-054**: 文件保存后输出 `✓ Saved to <path> (<size> KB)`。
- **FR-055**: HTTP 错误响应（非 2xx）时应输出 `✗ [status] <body>` 到 stderr 并退出码 1。

## 非功能需求

### 性能

- **NFR-001**: CLI 启动到命令执行应在 100ms 内完成（不含网络请求）。

### 可用性

- **NFR-010**: 命令行 `--help` 应显示所有可用子命令及描述。
- **NFR-011**: 错误信息应清晰指明问题和修复方式。

### 兼容性

- **NFR-020**: 要求 Node.js >= 18。
- **NFR-021**: package.json 应包含 `"engines": { "node": ">=18" }` 约束。

## 约束

- **C-001**: 使用 pnpm 作为包管理器。
- **C-002**: 使用 TypeScript + ESM (`"type": "module"`)。
- **C-003**: 使用 tsup 打包、vitest 测试。

## 验收标准

- [ ] **AC-001**: `oac config add diary --url http://localhost:3499 --openapi <spec>` 成功添加服务并生成 schema.json。
- [ ] **AC-002**: 对已存在服务执行 `config add` 报错。
- [ ] **AC-003**: `oac config set diary --headers '{"Authorization":"Bearer new"}'` 成功更新 header。
- [ ] **AC-004**: `oac config set diary --openapi <new-url>` 成功更新并自动重新生成 schema.json。
- [ ] **AC-005**: `oac config list` 显示所有服务信息。
- [ ] **AC-006**: `oac config remove diary` 成功删除服务。
- [ ] **AC-007**: `oac config refresh diary` 强制刷新 spec 和 schema。
- [ ] **AC-008**: `oac diary --help` 显示所有动态生成的子命令及描述。
- [ ] **AC-009**: `oac diary post-api-diary-get-month-list --body '{"month":"202603"}'` 成功发送 POST JSON 请求并打印响应。
- [ ] **AC-010**: 文件上传命令自动识别 binary 字段并以 FormData 上传。
- [ ] **AC-011**: 二进制响应自动保存到文件。
- [ ] **AC-012**: 错误 JSON 输入时显示友好错误信息。
- [ ] **AC-013**: 所有单元测试通过（spec-parser、command-builder、config、request）。
- [ ] **AC-014**: 集成测试通过（CLI 端到端行为验证）。
