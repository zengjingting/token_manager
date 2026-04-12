# 项目维度任务效率方案（待实现）

更新时间：2026-04-09

## 1. 目标

在同一个项目（agent 运行所在文件夹）维度，合并 Claude + Codex 的 token 数据，并计算：

`每 1 万 token 完成多少有效任务`

## 2. 核心定义

### 2.1 项目（project）

- 定义：agent 运行时的 `cwd`（绝对路径）。
- 统计口径：同一 `cwd` 视为同一项目。

### 2.2 任务（task）

- 定义：一条可独立验收的交付项，不是一次回复，不是一次 session。
- 任务示例：修复一个 bug、完成一个 PR、完成一份文档交付。

### 2.3 有效任务（effective task）

同时满足以下条件才记为有效任务：

1. 状态为 `done` / `merged` / `released`
2. `testsPassed = true`
3. 72 小时内未回滚、未重开

## 3. 录入与合并策略

## 3.1 录入策略（半自动）

- 不要求每个 session 结束都填写。
- 推荐在“开始新任务”或“任务完成”时更新一次任务记录。
- 系统先生成草稿（项目、时间、来源），用户只确认任务名与类型。

### 3.2 自动合并策略

- 主键：`projectPath + taskKey`
- 若 `taskKey` 相同，则跨多个 session 自动归并到同一任务。
- 无 `taskKey` 时，退化规则：
  - `projectPath` 相同
  - 归一化后的 `title` 相同
  - 时间窗口在 7 天内

## 4. 建议任务数据结构

建议新增文件：`data/effective-tasks.json`

```json
[
  {
    "taskKey": "bug-2026-04-09-login-timeout",
    "projectPath": "/Users/ting/Documents/Token_dashboard",
    "title": "修复登录超时",
    "type": "bugfix",
    "status": "done",
    "testsPassed": true,
    "rolledBack": false,
    "reopened": false,
    "createdAt": "2026-04-09T09:00:00+08:00",
    "completedAt": "2026-04-09T14:30:00+08:00",
    "notes": ""
  }
]
```

最小必填字段：

- `projectPath`
- `title`
- `type`
- `status`

建议强制字段：

- `taskKey`（用于稳定跨 session 合并）

## 5. 指标公式

### 5.1 项目总 token

`projectTotalTokens = claudeTokens + codexTokens`

### 5.2 有效任务数

`effectiveTaskCount = 项目内满足有效任务条件的任务数`

### 5.3 项目产出效率

`effectiveTasksPer10k = effectiveTaskCount / (projectTotalTokens / 10000)`

辅助反向指标：

`tokensPerEffectiveTask = projectTotalTokens / effectiveTaskCount`

## 6. 下次实现清单

1. 后端 reader 增加项目维度聚合（Claude + Codex 按 `cwd` 汇总）。
2. 新增任务读取器（读取 `data/effective-tasks.json`）。
3. 聚合层输出 `projectBreakdown`：
   - `projectPath`
   - `claudeTokens`
   - `codexTokens`
   - `totalTokens`
   - `effectiveTaskCount`
   - `effectiveTasksPer10k`
4. 前端新增“项目效率表”视图并支持排序。

## 7. 当前约束

- 目前项目尚未实现任务自动生成与自动归并逻辑。
- 先用本地任务文件作为真实任务来源，后续再接 GitHub/Jira/Linear。
