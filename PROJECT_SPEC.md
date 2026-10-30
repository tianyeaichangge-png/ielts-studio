# PROJECT_SPEC · 叶子的雅思小站（IELTS STUDIO）

> 全站开发的**永久设计与技术规范**。任何新会话、新功能或代码重构，均以本文件为绝对基准。
> 若代码与本文件冲突，应先修正代码使其符合本规范；若确需变更规范，必须先更新本文件并在提交信息中注明。

---

## 0. 技术栈

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 5 + React 18 + TypeScript（`strict: true`） |
| 样式 | Tailwind CSS（`tailwind.config.ts`，extend 而非覆盖）+ `src/styles/globals.css` 少量轻拟物工具类 |
| 持久化 | 浏览器 `localStorage`（统一经由 `src/hooks/useLocalStorage.ts`） |
| AI | DeepSeek V4 官方 API（`deepseek-v4-flash` / `deepseek-v4-pro`） |
| 部署 | Vercel（`vercel.json`） |
| 验证 | 每次改动后必须 `npm run build`（`tsc && vite build`）零错误通过 |

---

## 1. 核心工业设计规范

### 1.1 风格

**博朗 Dieter Rams 极简秩序 + 锤子便签轻拟物道林纸美学。**

- 以字体排印（Typography）与留白建立层级，而非色块、图标或多层边框。
- 纸面（`skeuo-paper`）置于暖灰亚麻桌面（`desk-surface`）之上；纸面顶部使用锤子便签式双细红线。
- 控件为"实体按键"：细腻边框 + 微投影 + 按下 `0.5px` 位移。
- 克制：一屏只允许一个博朗信号橙主行动按钮。

### 1.2 配色（标准色板）

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| 桌面暖灰亚麻 | `#E8E4DC` | 页面背景 `desk-surface` |
| 纸面底色 | `#FAF8F5` | 纸面、米白微凸按钮、气泡底色 |
| 博朗信号橙 | `#EA5B25` | 唯一主行动色、分数圆点、焦点下划线 |
| 边框与凹槽 | `#DCD6CC` | 按钮描边、分隔线、拨杆凹槽 |
| 深炭黑文字 | `#2C2A29` | 正文、标题、选中态文字 |
| 浅灰说明字 | `#8C867E` | 辅助说明、未选中态、铭牌 |

> [!NOTE]
> `tailwind.config.ts` 中历史 `braun.*` token（`paper #FAF8F2`、`ink #262523`、`muted #7A7873` 等）与部分组件内近似色仍在使用，属于兼容存量，**不得删除**；新代码一律使用上表标准色值。

**马克笔高亮色（划词高亮专用，严禁荧光纯色）**

| key | 圆点 | 高亮样式 | 笔记标记语法 |
| --- | --- | --- | --- |
| `yellow`（默认） | `#E6C37A` | `bg-[#F5E6C4]/80 text-[#2C2A29]` | `==文本==` |
| `orange` | `#EA5B25` | `bg-[#FADCD0]/75 text-[#9E3008]` | `==o:文本==` |
| `green` | `#7FA682` | `bg-[#DCE8DC]/80 text-[#254228]` | `==g:文本==` |

### 1.3 排版系统（四级字体栈）

| 用途 | 字体栈 | Tailwind |
| --- | --- | --- |
| UI 与中文 | `Inter, PingFang SC, Noto Sans SC, -apple-system, sans-serif` | `font-sans` |
| 英文例句、范文、改写句 | `Newsreader, Georgia, Noto Serif SC, serif` | `font-serif` |
| 数字、分数、仪表、铭牌 | `JetBrains Mono, monospace`，并启用 `fontVariantNumeric: 'lining-nums tabular-nums'` | `font-mono` |
| IPA 音标 | `Inter, Lucida Sans Unicode, Segoe UI, sans-serif`（独立字体栈，保证 IPA 字符完整） | `.font-ipa` |

- 标签与铭牌使用**首字母大写（Sentence case / Title case）**，如 `Task 1 · Dynamic · 01 / 03`、`Task 1 · Line graph`；**严禁大段全大写**。

### 1.4 标准控件

**米白微凸实体小按钮（全站默认可点击控件）**

```
bg-[#FAF8F5] hover:bg-[#F2EFE9] active:translate-y-[0.5px]
text-[#5C5852] hover:text-[#2C2A29]
border border-[#DCD6CC] shadow-[0_1px_2px_rgba(0,0,0,0.04)]
rounded-md px-3 py-1 text-xs font-sans transition-all
```

已完成 / 禁用态：`bg-[#EFECE6] text-[#8C867E] border border-[#DCD6CC] cursor-default`，文案前缀 `✓`（如 `✓ 已入库`、`✓ 已摘录`）。

**分类胶囊（筛选栏）**

- 选中：`bg-[#FAF8F5] text-[#2C2A29] font-medium shadow-xs border border-[#DCD6CC] rounded-lg px-3.5 py-1`
- 未选中：`text-[#8C867E] hover:text-[#2C2A29] px-3.5 py-1`

**凹槽拨杆**：顶部模块切换 `[ 背单词 | 写作 | 笔记 ]`、写作子模块 `[ Task 1 | Task 2 | 小练习 ]`，使用 `skeuo-switch-thumb` 凸起滑块。

**主行动按钮**：`skeuo-btn-orange`（每屏仅一个，如「批改这一句」「提交批改」）。

**自定义下拉**：一律使用自绘浮层菜单（参考【笔记】分类选择器），点击外部经 `mousedown` 关闭。

### 1.5 交互禁忌（红线）

- ❌ 严禁浏览器原生 `<select>`（含原生蓝色下拉高亮）。
- ❌ 严禁彩色 Emoji（允许 `✓ → ← ↻ × ·` 等单色排版符号）。
- ❌ 严禁 ASCII 方括号按钮文案 `[ xxx ]`。
- ❌ 严禁纯黑突兀方框、多层嵌套外框、花哨色块与渐变。
- ❌ 严禁 `<textarea>` 出现原生滚动条：使用 `overflow-hidden resize-none` + 按 `scrollHeight` 自动撑高。
- ❌ 严禁 Markdown 符号（`##`、`**`、`==`）在阅读态裸露。
- ❌ 严禁使用 `truncate` / `line-clamp` / 省略号截断释义、笔记或范文正文。

---

## 2. 核心架构

```
src/
├── App.tsx                         # 全局状态与 localStorage 汇总、跨模块回调
├── components/
│   ├── Navbar.tsx                  # 顶部仪器栏 + 三档模块拨杆
│   ├── ApiKeyModal.tsx             # DeepSeek API 设置（V4-Flash / V4-Pro 切换器）
│   ├── VocabularyModule.tsx        # 背单词：手账词表 + 3D 抽认卡
│   ├── WritingModule.tsx           # 写作：Task 1 / Task 2 题库、书写台、考官四模块报告
│   ├── MicroPracticeView.tsx       # 写作 · 小练习（三阶批改 + 历史记录）
│   ├── NotesModule.tsx             # 笔记手账（左目录 · 右信纸，阅读 / 编辑双模式）
│   └── SelectionHighlightPopover.tsx # 全局划词高亮与联动气泡（Portal 挂载）
├── lib/                            # 评分 Prompt、题库、默认词表、高亮工具等
├── hooks/useLocalStorage.ts
├── types/ielts.ts                  # 全站类型定义
└── styles/globals.css              # desk-surface / skeuo-* / font-ipa
```

### 2.1 跨模块联动

- 写作批改 → `[+ 入库]` → 背单词「写作积累」词盒（`vocabCategory: 'writing'`）。
- 写作批改 / 小练习 / 划词气泡 → `+ 摘录` → 笔记「摘录复盘」（固定笔记 `REVIEW_NOTEBOOK_ID`，以 `sourceKeys` 去重）。
- 划词气泡 `+ 存词` → `deepseek-v4-flash` 补全释义 → 「写作积累」。

### 2.2 划词气泡事件规范（防闪退）

- 仅在全局 `mousedown`（目标不在气泡内）时关闭；**禁止**用 `click` / `selectionchange` / `scroll` 关闭。
- `mouseup` 后延迟 `20ms` 读取 `window.getSelection()`，并缓存文本与坐标快照。
- 气泡及其所有按钮绑定 `onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}`。
- 气泡通过 `createPortal` 挂载至 `document.body`，与正文渲染隔离。

---

## 3. 存储 Schema（`localStorage`）

> [!IMPORTANT]
> 以下为**代码中实际使用的 Key**，是唯一事实来源。不得重命名；如需迁移，必须编写一次性兼容迁移逻辑（参照 `App.tsx` 中对 `ielts_studio_writing_reports_v1` 的迁移）并保留旧数据读取能力。

### 3.1 背单词 · `ielts_studio_vocab_deck_v1`

> 规范别名：`ielts_studio_words`（文档称呼，代码 Key 不变）。

`VocabularyCard[]`，6 个词盒视图：

| 词盒 | 判定 |
| --- | --- |
| 全部待背 | `status !== 'mastered'` |
| 待攻克 | `status` 为 `learning` / `vague` |
| 写作积累 | `vocabCategory === 'writing'` |
| Task 1 核心 | `vocabCategory === 'task1'` |
| Task 2 学术 | `vocabCategory === 'task2'` |
| 已掌握 | `status === 'mastered'` |

关键字段：`word`、`phonetic`、`partOfSpeech`、**`meaning` / `chineseMeaning`（精简版，2~3 个核心义，≤ 20 字，无括号注释）**、**`fullMeaning`（按词性完整义项、熟词僻义与雅思搭配，点击展开）**、`synonyms` / `paraphrasing`、`exampleSentence`、`exampleTranslation`、`status`、`reviewCount`、`vocabCategory`、`fromWriting`、`isCustom`。

- `originalError` 字段已全站废弃，读取旧数据时自动剔除。

### 3.2 小练习 · `ielts_studio_sentence_history`

`MicroPracticeHistoryRecord[]`（新记录置顶）：

`{ id, timestamp, taskType ('T1'|'T2'|'FREE'), category, questionId, chineseMeaning, rawSentence, targetWord?, userSentence, diagnosis, bandScore, band7Sentence, band8Sentence, structureFormula, lexicon[], highlights? }`

- 三阶批改：诊断 → Band 7.0 顺畅修改 → Band 8.0 高分重写 + 结构公式 + 重点词伙。
- 切题时按 `questionId` 匹配最新记录，回显「已练 (Band x.x)」与上次批改结果。
- 辅助 Key：`ielts_micro_practice_group_v1`、`ielts_micro_practice_subtype_v1`、`ielts_micro_practice_indices_v1`、`ielts_micro_practice_custom_questions_v1`。

### 3.3 笔记手账 · `ielts_studio_notes`

`NoteItem[]`：`{ id, title, category, subType, content, isPinned, updatedAt, sourceKeys? }`

- 顶栏固定四分类：`全部` | `Task 1` | `Task 2` | `摘录复盘`。
- `subType` 使用 Sentence case：
  - Task 1：`Line graph`、`Bar chart`、`Pie chart`、`Table`、`Map`、`Process`
  - Task 2：对应大作文题型标签
- 显示格式：`Task 1 · Line graph`。
- 阅读态自动解析 Markdown（`##`、`**`、列表、引用）及马克笔标记（`==…==`）。
- **无内置笔记**：笔记为空时严格保存 `[]`，不得回填默认数据；旧内置笔记由 `isLegacyBuiltInNote` 自动清理。

### 3.4 API 设置 · `ielts_studio_deepseek_config_v1`

> 规范别名：`ielts_studio_api_settings`（文档称呼，代码 Key 不变）。

`{ apiKey, endpoint, model: 'deepseek-v4-flash' | 'deepseek-v4-pro' }`，默认 `deepseek-v4-pro`；旧值 `deepseek-chat` / `deepseek-reasoner` 自动迁移为 `deepseek-v4-pro`。

**智能分流（与用户所选默认模型无关，按任务固定路由）**

| 任务 | 模型 |
| --- | --- |
| AI 添词、补全 `meaning` + `fullMeaning`、划词存词、小练习生词出题 | `deepseek-v4-flash` |
| Task 1 / Task 2 深度批改、小练习三阶批改 | `deepseek-v4-pro` |

### 3.5 写作模块

| Key | 内容 |
| --- | --- |
| `ielts_history_task1` / `ielts_history_task2` | `WritingEvaluationReport[]`，Task 隔离；含 `userHighlights?` 划词高亮 |
| `ielts_draft_task1` / `ielts_draft_task2` | 草稿、计时器、`viewStep`、`gradedReportId` |
| `ielts_task1_topic_bank_v1` | Task 1 题库（内置 SVG 图表题 + 历史沉淀），`chartType` 自动识别 |
| `ielts_task1_deleted_keys_v1` | 已删除题目，防止刷新后复活 |
| `ielts_active_task_type` | 当前 Task |
| `ielts_writing_micro_practice_mode_v1` | 是否处于小练习子模块 |
| `ielts_studio_writing_reports_v1` | **已废弃**，仅供一次性迁移读取 |

### 3.6 全局

| Key | 内容 |
| --- | --- |
| `ielts_studio_active_tab_v1` | `'vocabulary' \| 'writing' \| 'notes'` |

---

## 4. 防退化铁律

1. **视觉不退化**：任何改动必须保持第 1 节的色板、四级字体栈、控件样式与交互禁忌。
2. **数据向后兼容**：不得重命名或删除第 3 节中的 Key 与字段；新增字段一律可选（`?`），读取时提供默认值；结构变化必须附带迁移逻辑。
3. **功能不省略**：重构时不得擅自删除、合并或"简化掉"已有函数、回调、Prop 与功能入口；编辑代码时禁止用 `// ...` 或省略号替代未改动代码。
4. **内容不截断**：释义（尤其 `fullMeaning`）、笔记正文、考官范文与批改内容必须完整呈现，禁止 `truncate` / `line-clamp` / 字符截断。
5. **质量闸门**：提交前 `npm run build` 零 TypeScript 错误；提交信息清晰描述改动范围。
6. **规范优先**：本文件与临时需求冲突时，先与用户确认，再同步更新本文件。
