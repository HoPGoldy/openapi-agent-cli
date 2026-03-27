# 设计：OpenAPI 规范兼容性增强

## 架构概览

变更集中在三个模块，不增加新文件：

```
spec-parser.ts  →  增强 schema 解析能力
command-builder.ts  →  增强 help 展示 + contentType 分发
request.ts  →  新增 form-urlencoded / raw body 请求方式
```

## 组件设计

### 1. spec-parser.ts 变更

#### 1.1 allOf 合并

新增 `resolveComposedSchema(schema)` 函数：

```typescript
function resolveComposedSchema(schema: any): any {
  if (schema.allOf) {
    // 合并所有子 schema 的 properties 和 required
    const merged = { type: "object", properties: {}, required: [] };
    for (const sub of schema.allOf) {
      const resolved = resolveComposedSchema(sub);
      Object.assign(merged.properties, resolved.properties ?? {});
      merged.required.push(...(resolved.required ?? []));
    }
    // 保留顶层自身属性
    Object.assign(merged.properties, schema.properties ?? {});
    merged.required.push(...(schema.required ?? []));
    return merged;
  }
  if (schema.oneOf || schema.anyOf) {
    // 合并所有分支的 properties，标记为多选
    const variants = schema.oneOf ?? schema.anyOf;
    const merged = { type: "object", properties: {}, required: [] };
    for (const sub of variants) {
      const resolved = resolveComposedSchema(sub);
      Object.assign(merged.properties, resolved.properties ?? {});
    }
    return merged;
  }
  return schema;
}
```

在 `extractPropertySchema` 和 `extractBodySchema` 入口处调用。

#### 1.2 Path 级别 parameters

在 `parseSpec` 的外层循环中提取 `pathItem.parameters`，传入 `extractParameters`：

```typescript
for (const [path, pathItem] of Object.entries(spec.paths)) {
  const pathLevelParams = pathItem.parameters ?? [];

  for (const [method, operation] of Object.entries(pathItem)) {
    if (!isOperation(method)) continue;
    // 合并：operation 参数覆盖 path 级别同名参数
    const mergedParams = mergeParameters(pathLevelParams, operation.parameters ?? []);
    ...
  }
}
```

`mergeParameters` 按 `name + in` 去重，operation 级别优先。

#### 1.3 deprecated 标记

`CommandSchema` 新增 `deprecated?: boolean` 字段，从 `operation.deprecated` 读取。

#### 1.4 default 值

`PropertySchema` 新增 `default?: unknown` 字段。
`ParamSchema` 新增 `default?: unknown` 字段。

#### 1.5 contentType 检测增强

`getContentType` 增加对 `application/x-www-form-urlencoded`、`application/xml`、`text/plain` 的检测，按优先级返回实际 mediaType key。

### 2. command-builder.ts 变更

#### 2.1 deprecated 展示

```typescript
// 命令描述中加前缀
const desc = cmd.deprecated ? `[DEPRECATED] ${cmd.description}` : cmd.description;
const sub = group.command(cmd.name).description(desc);

// help 详情中加提示
if (cmd.deprecated) {
  sections.push("\n⚠ This API is deprecated");
}
```

#### 2.2 default 值渲染

在 `formatPropertyLine` 中追加 default 展示：

```typescript
const defaultStr = prop.default !== undefined ? `  default: ${JSON.stringify(prop.default)}` : "";
```

参数行同理。

#### 2.3 contentType 分发增强

action handler 中根据 contentType 分发：

```typescript
if (isMultipart && body) {
  // 现有 apiUpload
} else if (cmd.contentType === "application/x-www-form-urlencoded" && body) {
  await apiFormRequest(serviceConfig, resolvedPath, body, query, headers, timeout);
} else if (cmd.contentType === "application/xml" || cmd.contentType === "text/plain" || ...) {
  await apiRawRequest(serviceConfig, cmd.method, resolvedPath, cmd.contentType, rawBody, query, headers, timeout);
} else {
  // 现有 apiRequest (JSON)
}
```

新增 `--raw-body <text>` 选项用于原始文本发送。

### 3. request.ts 变更

#### 3.1 apiFormRequest

```typescript
export async function apiFormRequest(config, path, body, query?, headers?, timeout?): Promise<unknown> {
  // body 转为 URLSearchParams
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    params.set(k, String(v));
  }
  // fetch with Content-Type: application/x-www-form-urlencoded
}
```

#### 3.2 apiRawRequest

```typescript
export async function apiRawRequest(
  config,
  method,
  path,
  contentType,
  rawBody,
  query?,
  headers?,
  timeout?,
): Promise<unknown | null> {
  // 直接发送原始字符串，设置对应 Content-Type
}
```

## 错误处理

- 非 JSON contentType 下如果传了 `--body`（JSON 格式），尝试提取值发送；如果传了 `--raw-body`，优先使用
- `allOf` 合并属性冲突时后者覆盖前者（静默合并，不报错）
