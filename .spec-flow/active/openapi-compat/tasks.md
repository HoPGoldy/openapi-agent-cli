# 任务：OpenAPI 规范兼容性增强

## Phase 1: Schema 解析增强 (spec-parser.ts)

- [x] **T-001** 验证 swagger-parser dereference 后 allOf/oneOf/anyOf 是否保留 `[Low]`
  - 写测试用例，用含 allOf 的 spec 过 swagger-parser，检查输出
  - 文件: `__tests__/spec-parser.test.ts`

- [x] **T-002** 实现 `resolveComposedSchema` 处理 allOf/oneOf/anyOf `[Medium]`
  - 新增函数，合并子 schema 的 properties 和 required
  - 在 extractPropertySchema 和 extractBodySchema 入口处调用
  - 文件: `src/spec-parser.ts`
  - 依赖: T-001

- [x] **T-003** 实现 path 级别 parameters 合并 `[Medium]`
  - 新增 mergeParameters 函数（按 name+in 去重，operation 优先）
  - 修改 parseSpec 循环，提取 pathItem.parameters
  - 文件: `src/spec-parser.ts`

- [x] **T-004** 添加 deprecated 字段提取 `[Low]`
  - CommandSchema 新增 deprecated?: boolean
  - parseSpec 中从 operation.deprecated 读取
  - 文件: `src/spec-parser.ts`

- [x] **T-005** 添加 default 值提取 `[Low]`
  - PropertySchema 新增 default?: unknown
  - ParamSchema 新增 default?: unknown
  - extractPropertySchema 和 extractParameters 中提取
  - 文件: `src/spec-parser.ts`

- [x] **T-006** 增强 getContentType 检测 `[Low]`
  - 支持 application/x-www-form-urlencoded、application/xml、text/plain
  - 按优先级检测 mediaType key
  - 文件: `src/spec-parser.ts`

- [x] **T-007** 为 T-002 ~ T-006 编写单元测试 `[Medium]`
  - 每个功能点至少一个测试用例
  - 文件: `__tests__/spec-parser.test.ts`
  - 依赖: T-002, T-003, T-004, T-005, T-006

## Phase 2: Help 展示增强 (command-builder.ts)

- [x] **T-008** 展示 deprecated 标记 `[Low]`
  - 命令描述前缀 [DEPRECATED]
  - help 详情中提示 ⚠ This API is deprecated
  - 文件: `src/command-builder.ts`
  - 依赖: T-004

- [x] **T-009** 展示 default 值 `[Low]`
  - formatPropertyLine 中追加 default: <value>
  - 参数展示行中追加 default: <value>
  - 文件: `src/command-builder.ts`
  - 依赖: T-005

- [x] **T-010** 展示 contentType（非 JSON 时标注） `[Low]`
  - help 中显示 Content-Type: application/x-www-form-urlencoded 等
  - 文件: `src/command-builder.ts`
  - 依赖: T-006

- [x] **T-011** 为 T-008 ~ T-010 编写单元测试 `[Medium]`
  - 文件: `__tests__/command-builder.test.ts`
  - 依赖: T-008, T-009, T-010

## Phase 3: 请求发送增强 (request.ts + command-builder.ts)

- [x] **T-012** 实现 apiFormRequest (form-urlencoded) `[Medium]`
  - 新增函数，body 转 URLSearchParams 发送
  - 文件: `src/request.ts`

- [x] **T-013** 实现 apiRawRequest (xml/text/其他) `[Medium]`
  - 新增函数，原始字符串 + 对应 Content-Type 发送
  - 文件: `src/request.ts`

- [x] **T-014** command-builder 中添加 --raw-body 选项和 contentType 分发 `[Medium]`
  - 新增 --raw-body 选项
  - action handler 按 contentType 分发到对应 request 函数
  - 文件: `src/command-builder.ts`
  - 依赖: T-012, T-013

- [x] **T-015** 为 T-012 ~ T-014 编写单元测试 `[Medium]`
  - 文件: `__tests__/request.test.ts`, `__tests__/command-builder.test.ts`
  - 依赖: T-012, T-013, T-014

## Phase 4: 集成验证

- [x] **T-016** 更新 test fixture 添加复杂 spec 场景 `[Low]`
  - 添加 allOf、deprecated、form-urlencoded、path 级参数等场景
  - 文件: `__tests__/fixtures/test-spec.json`

- [x] **T-017** 运行全量测试 + 构建验证 `[Low]`
  - `pnpm test && pnpm build`
  - 依赖: 所有前置任务
