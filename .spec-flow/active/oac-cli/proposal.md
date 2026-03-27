# OAC CLI — 提案

> **状态**: 已批准
> **作者**: Copilot
> **创建日期**: 2026-03-27
> **最后更新**: 2026-03-27

## 背景

团队同时维护多个 API 服务（diary、note、probe 等），每个服务都有 OpenAPI 文档。目前调用接口需要 curl 手拼参数或使用 Postman/Insomnia 等 GUI 工具，流程繁琐且不利于脚本化和管道组合。

需要一个轻量级 CLI 工具，连接服务后从 OpenAPI spec 动态生成命令，实现 `oac diary post-api-diary-get-month-list --body '{"month":"202603"}'` 这样的一行调用。

## 目标

- [x] 目标 1：基于 OpenAPI spec 动态生成 CLI 命令树，CLI 本身不含任何业务接口代码
- [x] 目标 2：支持多服务管理（config add/set/remove/list/refresh）
- [x] 目标 3：支持 JSON body、query 参数、路径参数、自定义 header、超时控制
- [x] 目标 4：自动识别 multipart/form-data + format:binary 字段实现文件上传
- [x] 目标 5：根据响应 Content-Type 自动处理 JSON/文本/二进制下载
- [x] 目标 6：兼容 Swagger 2.0 / OpenAPI 3.x 格式
- [x] 目标 7：以 TDD 模式开发，所有核心模块有单元测试，CLI 有集成测试

## 非目标

- 不做交互式模式（prompts 引导填参，列入未来扩展）
- 不做 Shell 自动补全（列入未来扩展）
- 不做 Token 自动刷新（列入未来扩展）
- 不做 GUI / Web 界面

## 范围

### 包含

- 配置管理：config add/set/remove/list/refresh
- OpenAPI spec 拉取：远程 URL（带缓存）+ 本地文件
- Spec 解析：paths 遍历 → schema.json 生成 + 命令名冲突检测
- 动态命令注册：读 schema.json → commander 子命令
- HTTP 请求：JSON 请求、文件上传（FormData）、二进制下载
- 输出：JSON 打印 / 文本打印 / 文件保存
- 错误处理：JSON 解析错误、HTTP 错误、缺失参数友好提示
- 构建打包：tsup 单文件打包 + shebang
- 测试：vitest 单元测试 + execa 集成测试

### 不包含

- 交互式模式、Shell 补全、Token 刷新（未来扩展）
- npm 发布流程自动化

## 方案概述

基于 commander 构建命令框架，`config add` 时拉取 OpenAPI spec（通过 `@apidevtools/swagger-parser` 解析 $ref），转换为扁平 schema.json 缓存。CLI 启动时读 schema.json 直接注册子命令。命令名由 `{method}-{path-kebab}` 生成，路径参数保留（去花括号）。

## 风险与缓解

| 风险                                   | 可能性 | 影响 | 缓解措施                                   |
| -------------------------------------- | ------ | ---- | ------------------------------------------ |
| 某些 OpenAPI spec 非标准导致解析失败   | 中     | 中   | 使用 swagger-parser 做 $ref 展开和格式兼容 |
| commander 动态注册大量子命令导致启动慢 | 低     | 低   | schema.json 是 KB 级文件，注册开销 < 1ms   |
| Node 18+ 要求限制用户使用              | 低     | 低   | 明确标注 engines 字段                      |
