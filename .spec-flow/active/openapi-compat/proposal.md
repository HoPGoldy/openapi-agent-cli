# 提案：OpenAPI 规范兼容性增强

## 背景

当前 `oac` 的 spec-parser 和 request 模块只覆盖了最基础的 OpenAPI 3.x 场景（JSON body、multipart 上传）。在对接真实的第三方 API 时，会遇到以下未处理的规范特性，导致解析丢失字段或请求发送方式错误。

## 目标

- [x] 支持 `allOf` / `oneOf` / `anyOf` schema 组合，正确合并/展示属性
- [x] 支持 Path 级别 `parameters`（所有 operation 继承）
- [x] 在 help 中标记 `deprecated` 接口
- [x] 支持 `application/x-www-form-urlencoded` 请求体发送
- [x] 支持 `application/xml`、`text/plain` 等非 JSON 请求体的透传
- [x] 在 help 中展示参数/属性的 `default` 默认值

## 非目标

- 不支持 Swagger 2.0 规范（仅 OpenAPI 3.x）
- 不支持 `operationId` 作为命令名（保持现有路径命名策略）
- 不处理 Security Schemes 自动认证
- 不展示 Response Schema

## 范围

### 涉及

- `src/spec-parser.ts` — schema 组合解析、path 级参数合并、deprecated 标记、default 值提取、contentType 检测增强
- `src/command-builder.ts` — deprecated 展示、default 值渲染、contentType 分发增强
- `src/request.ts` — 新增 form-urlencoded / xml / text 请求发送
- `__tests__/` — 所有变更对应的测试

### 不涉及

- `src/config.ts` / `src/config-commands.ts` — 无变更
- `src/spec-loader.ts` — 无变更
- `src/index.ts` — 无变更

## 风险

| 风险                                                              | 影响              | 缓解方案                                              |
| ----------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `allOf` 合并可能有属性冲突                                        | 后声明覆盖先声明  | 采用后者覆盖策略，与 swagger-parser 行为一致          |
| swagger-parser 已对 `$ref` 做了 dereference，`allOf` 可能已被展平 | 可能无需处理      | 验证 dereference 后的 spec 输出，确认是否仍保留 allOf |
| 非 JSON 请求体缺少 schema                                         | help 无法展示字段 | 仅标注 Content-Type，不展示 body schema               |

## 开放问题

- swagger-parser dereference 后 `allOf`/`oneOf`/`anyOf` 是否仍保留？（需要实测验证）
