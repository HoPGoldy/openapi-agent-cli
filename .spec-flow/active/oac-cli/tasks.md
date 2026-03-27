# OAC CLI — 任务清单

> **状态**: 未开始
> **设计文档**: [design.md](./design.md)
> **开始日期**: 2026-03-27
> **开发模式**: TDD（先写测试，再实现）

---

## 🎛️ 执行模式 (AI Agent 必读)

**支持三种执行模式，用户可自由选择：**

| 模式                | 触发词                            | 行为                         |
| ------------------- | --------------------------------- | ---------------------------- |
| **单步模式** (默认) | "开始执行"、"start"               | 执行一个任务，等待确认，重复 |
| **批量模式**        | "全部执行"、"一口气执行"、"batch" | 连续执行所有任务，最后汇报   |
| **阶段模式**        | "执行第一阶段"、"execute setup"   | 执行一个阶段的任务，然后等待 |

**所有模式必须遵守：**

1. ✅ 严格按顺序执行 - 从第一个 `- [ ]` 开始
2. ✅ 检查依赖 - 执行前确认依赖任务已完成 (`- [x]`)
3. ✅ 更新状态 - 完成后将 `- [ ]` 改为 `- [x]`
4. ✅ 报告进度 - 显示 (N/Total)
5. ✅ 遇错即停 - 出错时立即停止，等待用户指示

**禁止行为：**

- ❌ 跳过任务
- ❌ 不按顺序执行
- ❌ 执行任务列表之外的工作
- ❌ 出错后继续执行

**TDD 规则：**

- ⚠️ 每个实现任务先写测试（或与实现同步写），确保测试覆盖对应需求
- ⚠️ 测试任务中的测试先写、先运行失败、再通过实现让其通过

---

## 概览

| Phase               | Tasks  | Completed | Progress |
| ------------------- | ------ | --------- | -------- |
| Setup               | 3      | 3         | 100%     |
| Core Implementation | 8      | 8         | 100%     |
| Integration         | 2      | 2         | 100%     |
| E2E Testing         | 1      | 1         | 100%     |
| **Total**           | **14** | **14**    | **100%** |

## Task Breakdown

### Phase 1: Setup

- [x] **T-001**: 项目初始化 — package.json + tsconfig.json + vitest.config.ts + tsup.config.ts
  - **Complexity**: Low
  - **Files**:
    - `package.json`
    - `tsconfig.json`
    - `vitest.config.ts`
    - `tsup.config.ts`
  - **Dependencies**: None
  - **Notes**: 配置 `"type": "module"`、`"engines": { "node": ">=18" }`、bin 字段包含 `oac` 和 `openapi-agent-cli`。安装 dependencies：commander、@apidevtools/swagger-parser；devDependencies：tsup、typescript、vitest、execa。

- [x] **T-002**: 安装依赖
  - **Complexity**: Low
  - **Files**: `pnpm-lock.yaml`
  - **Dependencies**: T-001
  - **Notes**: `pnpm install`

- [x] **T-003**: 创建 src 目录结构和空模块文件
  - **Complexity**: Low
  - **Files**:
    - `src/index.ts`
    - `src/config.ts`
    - `src/spec-loader.ts`
    - `src/spec-parser.ts`
    - `src/command-builder.ts`
    - `src/request.ts`
  - **Dependencies**: T-002
  - **Notes**: 每个文件先放最小导出骨架，确保 TypeScript 编译通过。同时创建 `__tests__/` 目录和 `__tests__/fixtures/` 目录。

### Phase 2: Core Implementation（TDD）

- [x] **T-010**: config.ts — 测试 + 实现
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/config.test.ts`
    - `src/config.ts`
  - **Dependencies**: T-003
  - **Notes**: TDD 流程。测试要点：loadConfig 无文件时返回空 services；addService 写入并可读回；addService 重名抛错；updateService partial merge；removeService 删除；本地 openapi 相对路径转绝对路径。使用临时目录隔离测试（vi.mock 或 tmpdir）。

- [x] **T-011**: spec-parser.ts — 测试 + 实现（纯函数，不涉及 I/O）
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/spec-parser.test.ts`
    - `src/spec-parser.ts`
  - **Dependencies**: T-003
  - **Notes**: TDD 流程。测试要点：pathToCommandName 各种路径；camelToKebab 转换；解析 JSON content type；解析 multipart + binaryFields；命令名冲突检测抛错；description 优先取 description 再取 summary；过滤非 operation 键（parameters 等）。先拆出纯解析函数（不含 fs 写入），单元测试只测纯函数。parseAndSave 中的 fs 写入单独测试。

- [x] **T-012**: spec-loader.ts — 测试 + 实现
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/spec-loader.test.ts`
    - `src/spec-loader.ts`
    - `__tests__/fixtures/test-spec.json`
  - **Dependencies**: T-010
  - **Notes**: TDD 流程。创建 fixture spec 文件。测试要点：本地文件加载成功；远程 URL 拉取（mock fetch）；缓存命中跳过拉取；缓存过期重新拉取；forceRefresh 忽略缓存；fetch 失败抛错。使用 vi.mock/vi.spyOn mock fetch 和 fs。

- [x] **T-013**: command-builder.ts — 测试 + 实现
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/command-builder.test.ts`
    - `src/command-builder.ts`
  - **Dependencies**: T-011
  - **Notes**: TDD 流程。测试要点：buildCommands 注册正确数量子命令；子命令名和描述正确；safeJsonParse 正常解析；safeJsonParse 错误 JSON 报友好错误（mock process.exit）；路径参数替换正确；缺失路径参数抛错。

- [x] **T-014**: request.ts — 测试 + 实现（apiRequest）
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/request.test.ts`
    - `src/request.ts`
  - **Dependencies**: T-003
  - **Notes**: TDD 流程。测试要点：JSON 响应正确返回；query 参数拼接到 URL；headers 合并（config headers + custom headers）；HTTP 错误输出 stderr + exit 1（mock）；text 响应打印文本；二进制响应保存文件；Content-Disposition 文件名提取；timeout 设置。使用 vi.mock 或 MSW mock fetch。

- [x] **T-015**: request.ts — 测试 + 实现（apiUpload）
  - **Complexity**: Medium
  - **Files**:
    - `__tests__/request.test.ts`（追加）
    - `src/request.ts`
  - **Dependencies**: T-014
  - **Notes**: TDD 流程。测试要点：FormData 正确构建；binaryFields 读取文件；普通字段附加；非 string 字段 JSON.stringify；headers 合并但不覆盖 Content-Type。

- [x] **T-016**: config 命令注册 — registerConfigCommands
  - **Complexity**: Medium
  - **Files**:
    - `src/config.ts`（添加 registerConfigCommands 函数）
    - `__tests__/config-commands.test.ts`
  - **Dependencies**: T-010, T-012, T-011
  - **Notes**: 实现 handleConfigAdd（检查重名 → fetchSpec → parseAndSave → addService）、handleConfigSet（partial merge + openapi 变更时 re-fetch）、handleConfigRemove、handleConfigList、handleConfigRefresh（单个或全部）。测试使用临时目录 + mock spec-loader。

- [x] **T-017**: index.ts — 入口组装
  - **Complexity**: Medium
  - **Files**:
    - `src/index.ts`
  - **Dependencies**: T-016, T-013
  - **Notes**: 组装 program：注册 config 命令 → 遍历服务注册动态命令 → `program.parse()`。Schema 缺失时注册占位 action。确保 `#!/usr/bin/env node` shebang（tsup banner 处理）。

### Phase 3: Integration

- [x] **T-020**: 构建验证 — tsup build + 本地执行
  - **Complexity**: Low
  - **Files**: `dist/index.js`
  - **Dependencies**: T-017
  - **Notes**: `pnpm build` 确保编译成功，`node dist/index.js --help` 输出正确，`node dist/index.js config list` 正常运行。

- [x] **T-021**: 创建 fixture spec 文件用于集成测试
  - **Complexity**: Low
  - **Files**: `__tests__/fixtures/test-spec.json`
  - **Dependencies**: T-020
  - **Notes**: 包含多种路径形式的完整 OpenAPI 3.0 spec：POST JSON、GET query、GET 路径参数、POST multipart upload。确保 spec 可被 swagger-parser 成功解析。如果 T-012 已创建则复用并扩充。

### Phase 4: E2E 测试

- [x] **T-030**: 集成测试 — CLI 端到端验证
  - **Complexity**: High
  - **Files**: `__tests__/cli.integration.test.ts`
  - **Dependencies**: T-021
  - **Notes**: 使用 execa 执行 `node dist/index.js`。测试场景：
    1. `config add test-svc --url ... --openapi <fixture>` 成功
    2. `config add test-svc ...` 重复添加报错
    3. `config list` 显示服务信息
    4. `config set test-svc --headers '{"X":"Y"}'` 成功
    5. `test-svc --help` 显示动态命令
    6. `unknown-svc some-cmd` 退出码 1
    7. `config remove test-svc` 成功
    8. `config refresh test-svc` 在 remove 后报错
       使用独立 config 目录（设置环境变量或临时目录）避免污染用户配置。集成测试前先 build。
