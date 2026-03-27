# 需求：OpenAPI 规范兼容性增强

## 功能需求

### FR-001: allOf / oneOf / anyOf 合并

当 schema 中存在 `allOf` 时，系统应将所有子 schema 的 properties 和 required 合并为一个扁平结构。

当 schema 中存在 `oneOf` 或 `anyOf` 时，系统应将所有子 schema 的 properties 合并展示，并在 help 中标注为 `(oneOf)` 或 `(anyOf)`。

### FR-002: Path 级别 parameters 继承

当 OpenAPI path item 上定义了 `parameters` 字段时，该路径下所有 operation 应继承这些参数。operation 自身的同名参数应覆盖 path 级别参数。

### FR-003: deprecated 标记

当 operation 设置 `deprecated: true` 时，系统应在以下位置展示标记：

- 命令列表中的描述前显示 `[DEPRECATED]` 前缀
- 命令 help 详情中显示 `⚠ This API is deprecated`

### FR-004: application/x-www-form-urlencoded 支持

当 contentType 为 `application/x-www-form-urlencoded` 时，系统应将 `--body` JSON 转换为 URL 编码的表单格式发送。

### FR-005: 非 JSON 请求体透传

当 contentType 为 `application/xml` 或 `text/plain` 等非 JSON 类型时：

- 系统应将 `--body` 的值作为原始字符串发送（不做 JSON.parse）
- 新增 `--raw-body <text>` 选项用于直接传递原始文本

### FR-006: default 值展示

当 schema 属性或参数定义了 `default` 值时，系统应在 help 中展示为 `default: <value>`。

## 非功能需求

### NFR-001: 向后兼容

已缓存的 schema.json 中缺少新字段时，系统应正常降级运行（不崩溃）。

## 验收标准

- AC-001: 包含 `allOf` 的 spec 能正确解析出合并后的所有属性
- AC-002: `oneOf`/`anyOf` 的属性能展示，并有类型标注
- AC-003: path 级别参数出现在所有子 operation 的 help 中
- AC-004: deprecated API 在列表和 help 中有明显标记
- AC-005: form-urlencoded 请求体正确编码发送
- AC-006: xml/text body 原样透传，带正确 Content-Type
- AC-007: default 值在 help 中正确展示
- AC-008: 所有新功能有对应的单元测试
