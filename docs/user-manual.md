# Token Dashboard 使用手册

> 版本：2026-04  
> 地址：http://localhost:3333

---

## 目录

1. [概述](#概述)
2. [仪表盘](#仪表盘)
   - [时间周期选择器](#时间周期选择器)
   - [统计卡片](#统计卡片)
   - [Token 分布图](#token-分布图)
   - [模型分布图](#模型分布图)
   - [项目成本分布图](#项目成本分布图)
   - [会话列表](#会话列表)
3. [会话历史](#会话历史)
   - [会话列表侧栏](#会话列表侧栏)
   - [会话详情](#会话详情)
   - [搜索](#搜索)
   - [导出](#导出)

---

## 概述

Token Dashboard 聚合来自两个工具的 Token 用量数据：

| 数据源 | 工具 | 原始数据位置 |
|---|---|---|
| **Claude** | Claude Code CLI | `~/.claude/projects/**/*.jsonl` |
| **Codex** | OpenAI Codex CLI | `~/.codex/sessions/**/*.jsonl` |

**仪表盘**同时展示两个来源的用量；**会话历史**目前仅展示 Claude Code 的会话记录。 -- Remark：会话历史需要同时展示claude code和codex的。

数据**每 30 秒自动刷新**，无需手动操作。-- Remark：仪表盘和会话历史都是每30s自动刷新吗？

---

## 仪表盘

### 时间周期选择器

位于顶部导航栏，选择后仪表盘所有数据即时更新。

| 选项 | 含义 | X 轴粒度 |
|---|---|---|
| **5小时** | 从当前时刻往前推 5 小时 | 小时（如 `14:00`） |
| **今日** | 从今日 00:00 至当前时刻 | 单柱（全天合并为一条） |
| **3天** | 今日 + 前 2 个自然日 | 日 |
| **7天** | 今日 + 前 6 个自然日 | 日 |
| **自定义** | 手动选择起止日期 | 日 |

**数据读取方式**：
- `5小时`：直接扫描 JSONL 文件，实时解析每条 assistant 条目。-- Remark：为什么5小时不能使用ccusage命令行工具进行读取？
- 其余周期：调用 `ccusage`（Claude）和 `@ccusage/codex`（Codex）命令行工具，由工具输出聚合后的日度数据。

---

### 统计卡片

页面顶部 4 张卡片，鼠标悬停显示字段说明。 -- Remark：把鼠标悬停效果改成在统计卡片标题（如“总费用”）的右侧增加一个提示的icon（形状是一个圆里面有一个！），鼠标悬停在icon上时展示字段说明。

#### 总 Token

**含义**：所选周期内消耗的全部 Token 数量之和。  -- Remark：把现有的提示说明文案改成“本周期内Claude+Codex消耗的Token数量之和，包括输入+输出+缓存创建+缓存读取”

**计算公式**：
```
总Token = 输入Token + 输出Token + 缓存创建Token + 缓存读取Token
```

各字段来源：

| 字段 | Claude 数据源 | Codex 数据源 |
|---|---|---|
| 输入Token | JSONL `message.usage.input_tokens` | JSONL `token_count.last_token_usage.input_tokens` |
| 输出Token | JSONL `message.usage.output_tokens` | JSONL `token_count.last_token_usage.output_tokens` |
| 缓存创建Token | JSONL `message.usage.cache_creation_input_tokens` | ❌ Codex 无此字段，计为 0 |
| 缓存读取Token | JSONL `message.usage.cache_read_input_tokens` | JSONL `token_count.last_token_usage.cached_input_tokens` |

副标题显示：`输入:xxx 输出:xxx`（输入 + 输出 的分项，不含缓存）

---

#### 总费用

**含义**：所选周期内 Claude + Codex 的合计 API 费用，单位 USD。 -- Remark：把现有的提示说明文案改成“本周期内Claude+Codex的合计 API费用”

**计算公式**：
```
总费用 = Σ Claude 各条目 costUSD + Σ Codex 各条目 costUSD   -- Remark：需要在统计卡片的小字里分别标注两个来源的costUSD.前端展示示例：claude code:xx USD codex: xx USD
```

| 工具 | 费用来源 |
|---|---|
| Claude | JSONL 每条 assistant 条目的 `costUSD` 字段（由 ccusage CLI 在写入时计算） |
| Codex | ccusage/codex CLI 工具按 API 定价计算后输出 |。--Remark：为什么不能从codex的JSONL每条 assistant 条目的 `costUSD` 字段取？还是因为本来就没有？

---

#### 缓存命中率

**含义**：上下文缓存被复用的比例。命中率越高，说明重复内容越多、费用越低。

**计算公式**：
```
缓存命中率 = 缓存读取Token ÷ (缓存读取Token + 缓存创建Token)
```

- 分子：`cache_read_input_tokens`（Claude）+ `cached_input_tokens`（Codex）
- 分母：上述之和 + `cache_creation_input_tokens`（仅 Claude 有） -- Remark:既然只有claude有缓存创建的数据，那就只计算claude的缓存命中率好了。在统计卡片里标注一下，把现在的“读取 / (读取 + 创建)”文案改成“仅claude code”
- 若分母为 0（无任何缓存活动），显示 `—`

---

#### 模型数

**含义**：所选周期内使用过的不同 AI 模型的数量。

副标题显示前 2 个模型名（去掉 `claude-` 前缀）。

**数据来源**：
- Claude：JSONL 每条 assistant 条目的 `message.model` 字段，排除值为 `<synthetic>` 的内部占位条目。
- Codex：Codex JSONL 中 `turn_context` 事件的 `payload.model` 字段，默认值为 `gpt-5.3-codex`。

---

### Token 分布图

**类型**：分组柱状图，含 6 个系列。

| 系列 | 颜色 | 数据含义 |
|---|---|---|
| Claude 输入 | 橙色（深） | Claude `input_tokens` |
| Claude 输出 | 橙色（中） | Claude `output_tokens` |
| Claude 缓存 | 橙色（浅） | Claude `cache_creation_input_tokens + cache_read_input_tokens` | --Remark：需要在对应的标签上悬停提示“缓存创建+缓存读取”
| Codex 输入 | 蓝色（深） | Codex `input_tokens` |
| Codex 输出 | 蓝色（中） | Codex `output_tokens` |
| Codex 缓存 | 蓝色（浅） | Codex `cached_input_tokens` | --Remark：需要在对应的标签上悬停提示“仅缓存创建”

**操作**：点击图例中的系列标签，可切换该系列的显示/隐藏。至少保留一个系列可见。

Y 轴上限 = 当前可见系列最大值 × 1.1，随系列切换动态调整。

**5小时周期的特殊说明**：X 轴为小时桶（本地时间），数据直接从 JSONL 实时计算，不经过 CLI 工具。

---

### 模型分布图 -- Remark:名字改成“模型成本分布”。另外想确认，这部分数据会随时间周期选择器刷新吗？

**类型**：环形图（Doughnut Chart）。

**展示内容**：每个模型占总费用的百分比。--Remark:这个总费用是所选时间周期里的总费用吗？

**计算方式**：
```
某模型占比 = 该模型 totalCost ÷ 所有模型 totalCost 之和 × 100%
```

若所有模型均无费用数据（cost = 0），改用 totalTokens 计算占比。

Tooltip 显示：模型名、费用金额、百分比。

---

### 项目成本分布图 -- Remark:现在前端这个模块都是空白的，没有数据，是什么原因？

**类型**：水平柱状图，展示消耗费用最多的前 15 个项目。

**数据来源**：扫描 `~/.claude/projects/` 下所有 JSONL 文件，按目录（项目）聚合所有会话的 `costUSD`。

**注意**：
- 仅包含 Claude Code 数据，不含 Codex。-- Remark：为什么？
- 项目名由目录名解码而来（去掉路径中的通用词：`users`、`documents`、`downloads` 等）。 
- **页面加载时自动触发一次数据拉取**，此后不随时间周期选择器变化而刷新。 

---

### 会话列表

位于页面底部，展示所选周期内的明细会话，最多显示 **50 条**，按最后活动时间降序排列。

| 列名 | 含义 | 计算 / 来源 |
|---|---|---|
| 来源 | 工具来源 | `CLAUDE` 或 `CODEX` 标签 |
| 会话 | 会话 ID 缩略 | Session ID 末 14 位；Claude 为 UUID，Codex 为相对文件路径 | 
| TOKEN | 会话总 Token | `inputTokens + outputTokens + cacheTokens` |
| 输入 | 输入 Token | 直接取数 |
| 输出 | 输出 Token | 直接取数 |
| 缓存 | 缓存 Token | Claude: `cacheCreation + cacheRead`；Codex: `cachedInput` |
| 费用 | 会话费用 USD | 直接取数，格式 `$0.0000` |
| 最后活动 | 最后一条 assistant 条目的时间戳 | 格式：`MM/DD HH:mm`（本地时间） |
| 模型 | 本会话使用的模型 | 去掉 `claude-` 前缀后展示，多个模型逗号分隔 |

悬停行高亮，完整 Session ID 可通过鼠标悬停于会话列查看（title tooltip）。

---

## 会话历史

**数据来源**：`~/.claude/projects/**/*.jsonl`，仅含 Claude Code 会话，不含 Codex。 -- Remark:需要增加来自codex的会话记录。

### 会话列表侧栏 

左侧侧栏按**项目（目录）**分组展示所有 Claude Code 会话。 -- Remark：增加codex的会话记录后，依旧按照项目分组展示，但是项目里的会话要带工具来源标签，样式和仪表盘会话列表里的工具来源标签一致。

**分组**：每个项目对应 `~/.claude/projects/` 下的一个子目录，点击项目标题可展开/收起该项目的会话列表。默认展开第一个项目。

**每条会话显示**：

| 字段 | 含义 | 来源 |
|---|---|---|
| 标题 | 会话主题 | 自定义标题（见下文）；或取该会话第一条有效 user 消息，截取前 80 字符 |
| 时间 | 最后活动时间 | JSONL 文件中所有带 `timestamp` 字段的条目取最大值，格式 `MM/DD HH:mm` | 
| Token | 会话总 Token | `inputTokens + outputTokens + cacheTokens`，同仪表盘口径 |
| 费用 | 会话费用 | 所有 assistant 条目 `costUSD` 之和，格式 `$0.0000` |--Remark:为什么现在每个会话的费用都是0

**复制 Session ID**：悬停于会话条目，右侧出现 `⧉` 图标：--Remark:希望在复制图标左侧新增一个删除图标。支持点击删除session记录。（对应于本地路径的session记录删除。可以先确认下现在的记录存储情况，看具体是哪个颗粒度的删除。点击删除后需要二次确认弹窗，强调删除后记录不可恢复，防止误触。（这个功能是否有利于释放我的本地存储空间？）
- **悬停**图标：tooltip 显示完整 Session ID（UUID）
- **点击**：将 Session ID 复制到剪贴板，图标短暂变为 `✓`

**自定义标题（重命名）**： -- Remark：我希望增加一个功能：在会话历史自定义session标题之后，仪表盘的会话列表里的会话ID可以同步为自定义标题（悬停显示原始session ID ），点击可以跳转会话历史页面对应的session的会话详情。
- 打开会话详情后，悬停于标题区域，出现 `✎` 按钮
- 点击 `✎` 后，标题文字变为可直接编辑状态（无弹窗）
- `Enter` 或点击其他区域保存，`Escape` 取消
- 自定义标题存储于**浏览器 localStorage**，key 为 `claude-session-name-{sessionId}`，不写入服务端
- 搜索功能同时检索自定义标题

---

### 会话详情

点击左侧任意会话条目后，右侧展示该会话的完整对话内容。

**顶部元信息栏**：

| 字段 | 含义 | 来源 |
|---|---|---|
| 标题 | 会话主题 | 同侧栏（自定义标题优先） |
| 时间 | 最后活动时间 | 同侧栏，但格式为完整日期时间 |
| Tokens | 会话总 Token | 同仪表盘口径 |
| 费用 | 会话费用 | 同侧栏 |
| 模型 | 使用的模型列表 | 去掉 `claude-` 前缀，多个逗号分隔 |

**消息渲染规则**：

| 消息类型 | JSONL 来源 | 展示样式 |
|---|---|---|
| 用户消息 | `type=user`，`message.content[].type=text` | 白色背景，`USER` 标签 | 
| Assistant 回复 | `type=assistant`，`message.content[].type=text` | 浅灰背景，`ASSISTANT` 标签 |
| 工具调用 | `type=assistant`，`message.content[].type=tool_use` | 灰色折叠块，显示工具名 |
| 工具结果 | `type=user`，`message.content[].type=tool_result` | 灰色折叠块，显示工具名 |

**特殊处理**：
- `isMeta=true` 的条目（系统注入的上下文消息）不渲染。
- `<tag>...</tag>` 格式的 XML 标签从 user 消息内容中自动剥除后渲染。
- `system/compact_boundary` 等系统条目目前静默忽略，不渲染。

**操作记录（工具调用）**：默认隐藏，点击右上角 **「展示操作记录 (N)」** 按钮可展开所有工具调用和结果，按钮再次点击收起。N 为当前会话中工具条目的总数。 -- Remark:文案“展示操作记录 (N)”改成“展示工具调用记录（N）”

展开单条工具详情：点击折叠块的标题行可展开/收起该条的 JSON 内容，工具结果内容最多显示前 500 字符。

**分页加载**：每次加载 100 条消息，点击底部「加载更多」按钮追加下一页。

---

### 搜索

点击顶部导航栏切换至会话历史后，顶部工具栏出现搜索框。

**操作**：在搜索框输入关键词，点击「搜索」或按 `Enter` 触发。点击「× 清除」恢复完整列表。

**搜索范围**：-- Remark:新增一个在当前选中会话历史中搜索的功能。交互流程：点击放大镜图标，右侧出现搜索边栏，顶部有搜索框，输入关键词，点击搜索，边栏里出现候选记录（一个个块展示），点击消息块，会话记录正文部分自动跳转到对应聊天块，消息块短暂高亮示意，匹配词橙色高亮标注。搜索支持根据消息类型筛选搜索范围，可选搜索范围先做两个：用户消息、Assistant回复。（在选择搜索范围时，不影响正文展示的范围）
1. **服务端全文搜索**：遍历所有 JSONL 文件中 `type=text` 的消息内容，不区分大小写。
2. **本地自定义标题搜索**：同时检索 localStorage 中所有自定义标题，结果合并去重后展示。 

**结果展示**： -- Remark:新增排序规则：优先展示和自定义标题关键词匹配的结果，然后再按最后活动时间降序
- 每条结果显示项目名、会话标题
- 最多展示 **3 个文本片段**，每个片段含匹配词前后各 40 个字符，匹配词以橙色高亮标注
- 结果按最后活动时间降序排列

---

### 导出 -- Remark:把导出和选择解耦。1、支持消息块级别的筛选：把所有消息块（用户消息、Assistant 回复、工具调用、工具结果）做成可选的（每个块最左侧有个选择框）。在没有任何消息被选中时，按钮置灰。存在消息选中，按钮才可点击。然后点击【↓ Markdown】，仅导出选中的消息块。2、支持按照消息类型导出，支持3个类型过滤：用户消息记录、AI回复记录、工具调用记录。（选择导出的过滤条件时，前端的展示的内容也要过滤，并且选择框默认全选的状态，支持用户在此状态下再去取消一些消息块的选中态，进一步筛选记录）

会话详情右上角「↓ Markdown」按钮，将当前会话导出为 `.md` 文件。--Remark：现在默认导出的md文件的存储路径是哪里？

**文件内容**：
- 元信息头（Session ID、项目、时间、模型、Token 用量、费用）
- 完整对话消息，包括用户消息、Assistant回复、工具调用（JSON 代码块）、工具结果（最多 2000 字符）

**文件名格式**：`{sessionId前8位}-{标题前30字符}.md`（标题中非字母数字字符替换为 `-`）-- Remark:标题能否支持中文字符？不想要标题中的非字母数字字符被替换。

**注意**：导出包含所有消息，不受「操作记录」显示/隐藏状态影响。 
