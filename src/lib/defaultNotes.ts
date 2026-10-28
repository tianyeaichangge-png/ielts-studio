import { NoteCategory, NoteItem } from '../types/ielts';
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  extractAndParseJson,
} from './geminiEvaluator';

export const NOTE_CATEGORIES: NoteCategory[] = [
  'Task 1 技巧',
  'Task 2 逻辑',
  '句法与词伙',
  '批改复盘',
  '核心讲义',
];

export const NOTE_FILTER_TABS: Array<{
  key: 'ALL' | NoteCategory;
  label: string;
}> = [
  { key: 'ALL', label: '全部' },
  { key: 'Task 1 技巧', label: 'Task 1 技巧' },
  { key: 'Task 2 逻辑', label: 'Task 2 逻辑' },
  { key: '句法与词伙', label: '句法与词伙' },
  { key: '批改复盘', label: '批改复盘' },
  { key: '核心讲义', label: '核心讲义' },
];

export const REVIEW_NOTEBOOK_ID = 'note-review-archive';
export const REVIEW_NOTEBOOK_TITLE = '批改与小练习复盘手账';

/**
 * 4 Built-in Examiner-Grade Initial Handbooks ("压箱底考官级初始手账")
 */
export const BUILTIN_EXAMINER_NOTES: NoteItem[] = [
  {
    id: 'builtin-note-task1-dynamic-static',
    title: 'Task 1 动态图 vs 静态图：Band 7.5+ 核心句型骨架全解',
    category: 'Task 1 技巧',
    isPinned: true,
    updatedAt: '2026-10-28T09:00:00.000Z',
    content: `## 一、 动态图（趋势变化）：告别单一主谓，掌握四维句式轮换

在动态图（折线图、跨年柱图/饼图/表格）中，考官评判 GRA 7.5+ 的核心标准是避免连续使用 "The number of X increased" 的机械句型。必须在同一段落内交替使用以下四类高阶骨架：

> FORMULA 01 · 动词+副词 ⇄ 形容词+名词（There be / Witness 转换）
> [主体/趋势] + **witnessed / experienced / underwent** + a + [程度形容词] + [趋势名词], [分词伴随补具体数值].

The proportion of renewable energy **experienced a pronounced surge** from 12% in 1990 to 38% in 2020, **before plateauing at** roughly 40% over the final decade.

> FORMULA 02 · 现在分词作结果/伴随状语（跨阶段自然衔接）
> [主句描述第一阶段趋势], **surging / plummeting / peaking at** [数据] in [年份], **followed by** + [名词化第二阶段趋势].

Car ownership in urban households **rose steadily** during the initial decade, **peaking at** 78% in 2015, **followed by a marginal contraction** to 71% by the end of the period.

> FORMULA 03 · 倒装/被动数据尾重句（凸显极值与拐点）
> **A similar upward trajectory was observed in** [对象 B], which **climbed threefold** to reach [数据].

## 二、 静态图（倍比与极值）：精准量化差距与占比

静态图严禁出现 "increase / decrease" 等时间趋势词（除非题干明确跨年），核心任务是用高级比较结构呈现【首位极值】、【倍数关系】与【末位垫底】：

> FORMULA 04 · 极值压制与倍数同位语结构
> [排名第一项] **accounted for the lion's share of** [总体] (at X%), **dwarfing** [末位项] (Y%) **by a factor of nearly three**.

Housing expenditure **accounted for the largest proportion of** total household budgets at 36%, **nearly triple the figure for** entertainment and leisure (12.5%).

> FORMULA 05 · With 独立主格补齐精确成对数据（避免繁琐从句）
> [主句定性对比], **with** [A 的指标] **standing at** X% **compared to** a mere Y% for [B].

Male undergraduates **showed a marked preference for** Computer Science, **with the enrollment rate standing at** 48% **as opposed to** a mere 14% among their female counterparts.

## 三、 考官避坑铁律（Common Pitfalls）
- 严禁混淆 **percentage / proportion**（比例，接不可数或复数总体）与 **number**（具体可数数量）：比例高低只能用 **high / low / large / small**，绝不可写 "the percentage was many/more"。
- 引用具体年份数据时，静态状态用 **at 45% in 2010**，跨度净增幅用 **by 15%**，到达终点值用 **to 60%**。`,
  },
  {
    id: 'builtin-note-task1-map-process',
    title: 'Task 1 地图题与流程图：方位变迁与被动工序满分公式',
    category: 'Task 1 技巧',
    isPinned: false,
    updatedAt: '2026-10-28T08:40:00.000Z',
    content: `## 一、 地图题（空间变迁）：无灵主语 + 原址替换词伙

地图题想要拿到 Band 7.5+，必须跳出 "There was a park, and now it is a supermarket" 的流水账，灵活运用【方位作主语】与【原址拆除让位】结构：

> FORMULA 01 · 方位区域拟人主语（Witness / Undergo 空间重构）
> The [方位: north-western corner / riverfront area] **witnessed a complete transformation**, **with** the former [旧设施] **being demolished to make way for** [新设施].

The northern sector of the town **underwent dramatic urbanization**, **with** the extensive farmland **being cleared to make way for** a modern commercial complex and an adjacent car park.

> FORMULA 02 · 以牺牲…为代价的扩建（At the expense of）
> The [某设施] **was substantially expanded / doubled in size** **at the expense of** the surrounding [被挤占的绿地/旧建筑].

The central library **was enlarged considerably** and **converted into** a multi-functional cultural center **at the expense of** the woodland to its west, which **shrank by half**.

## 二、 方位介词三剑客精准辨析（in / on / to）
- **in the north of X**：在 X 内部偏北区域（包含在版图内部）。
- **on the north side / bank of X**：紧贴 X 的北侧边界或北岸（接壤毗邻）。
- **to the north of X**：在 X 外部以北的独立区域（不接壤，隔开一段距离）。

## 三、 流程图（工序衔接）：跨阶段分词构句与条件闭环

流程图的核心在于打破 "First... Second... Then... Next..." 的机械罗列，用【过去分词先时态】与【名词化阶段词】将孤立步骤串联成严谨的工业/自然链条：

> FORMULA 03 · 过去分词前置（Once / Having been 承上启下）
> **Once / Having been** [步骤A的过去分词: harvested / sorted / crushed], the [原料] **is subsequently channeled into** [设备B] **where** [定语从句描述工序C].

**Once extracted from** the underground quarry, the raw clay **is placed onto** a metal grid **so that** oversized fragments and impurities **can be sifted out**.

> FORMULA 04 · 阶段名词化与最终成型闭环
> **Following a 48-hour fermentation process under** high temperature and pressure, the purified liquid **is transferred to** a cooling tower **prior to being packaged for** commercial distribution.`,
  },
  {
    id: 'builtin-note-task2-tr-cc-logic',
    title: 'Task 2 四大题型审题破题与段落推进逻辑（TR & CC 核心）',
    category: 'Task 2 逻辑',
    isPinned: true,
    updatedAt: '2026-10-28T08:20:00.000Z',
    content: `## 一、 观点类（To what extent do you agree or disagree）

面对含有绝对化修饰词（如 *only, best, inevitable, no longer necessary*）的题干，最稳健的 Band 8.0 破题策略是 **7:3 让步反驳结构（Qualified Agreement / Disagreement）**：先承认对方合理面，再指出其逻辑盲区或长远隐患。

> FORMULA 01 · 让步段（Admittedly）+ 核心削弱（However, this view overlooks...）
> **Granted, there is a grain of truth in the assertion that** [让步承认合理性]. **Nevertheless, equating** [片面做法] **with** [终极目标] **is fundamentally flawed, as it overlooks** [深层代价].

**Granted, prioritizing vocational training** equips graduates with immediate employability. **Nevertheless, marginalizing theoretical disciplines is profoundly short-sighted, as it erodes** a nation's capacity for foundational scientific breakthroughs.

## 二、 双边讨论（Discuss both views and give your opinion）

主体段一与主体段二必须使用**客观中立的归因词伙（Attribution）**转述正反双方立场，避免在转述他人观点时直接混入个人情绪，到结论段（或主体段二尾句）再以强逻辑收束个人立场：

> FORMULA 02 · 双边立场的学术化转述与转折对比
> **Proponents of** [观点A] **frequently cite** [核心论据1] **as the primary justification.** / **Conversely, detractors contend that** [观点B的隐患] **far outweighs** its short-term convenience.

**Advocates of** remote working ** contend that** flexible schedules **foster greater work-life autonomy**, **whereas critics express concern that** the absence of face-to-face interaction **undermines team cohesion and collaborative synergy**.

## 三、 利弊类（Do the advantages outweigh the disadvantages?）

切忌写成“一段好处、一段坏处、结尾喊口号大于”的割裂结构！Band 8.0 要求在段落衔接处直接体现**权重掂量（Weighing）**，证明为何弊端是可控的（manageable/transient），而收益是根本性的（structural/transformative）：

> FORMULA 03 · 弊端可缓解 vs 收益不可替代的权重裁决句
> **While the drawbacks surrounding** [具体弊端] **are undeniably real, they are largely transitional and can be mitigated through** [监管/政策手段], **rendering the long-term socioeconomic gains far more decisive.**

## 四、 报告类（Causes & Solutions）：因果链条与对策靶向匹配

分析原因时拒绝空泛的 "Because people are busy"，必须从 **经济社会结构（Macroeconomic pressures）** 与 **技术/制度诱因（Technological/Institutional drivers）** 切入，且解决方案必须与前文原因严丝合缝一一对应。`,
  },
  {
    id: 'builtin-note-nominalization-inanimate',
    title: '告别中式口语：雅思写作「名词化与无灵主语」升格指南',
    category: '句法与词伙',
    isPinned: false,
    updatedAt: '2026-10-28T08:00:00.000Z',
    content: `## 核心法则：将“人+动词（People do...）”转化为“抽象名词短语+学术关系动词”

中式英语（Band 5.5~6.0）最大的特征是句句以 *People / We / Students / Government* 开头，动作全部压在简单动词上；而学术英语（Band 7.5~8.5）擅长利用**名词化（Nominalization）**将整句动作浓缩为主语或宾语，搭配因果、催生、侵蚀等关系动词。

> FORMULA · 名词化因果驱动公式
> **The proliferation / scarcity / implementation of** [名词化原因] **has given rise to / exacerbated / catalyzed** [名词化结果], **thereby compelling** [受影响方] **to** [后续动作].

## 六组高频 5.5 分大白话 ➔ Band 8.0 考官句对比拆解

1. **科技与社交疏离**
- 5.5分原句：Because people use smartphones too much every day, family members talk less to each other face to face.
- 8.0分升格：**The pervasive reliance on** smartphones **has eroded** face-to-face familial communication, **breeding a sense of** emotional alienation within households.

2. **城市化与住房危机**
- 5.5分原句：Many rural people move to big cities too fast, so there are not enough houses and the price is very high.
- 8.0分升格：**The rapid influx of** rural migrants into metropolitan areas, **coupled with** speculative real estate investment, **has exacerbated** acute housing shortages and **driven up** property prices.

3. **环保与短视经济**
- 5.5分原句：If countries only care about making money and pollute the nature, humans cannot live well in the future.
- 8.0分升格：**Pursuing** relentless economic expansion **at the expense of** ecological integrity **poses an existential threat to** long-term human sustainability.

4. **在线教育与自律差距**
- 5.5分原句：Online classes are cheaper and convenient, but students who cannot control themselves will give up easily.
- 8.0分升格：**Despite dismantling** geographical barriers and **lowering** tuition costs, online learning **renders** students with limited self-discipline **vulnerable to** high dropout rates.

5. **老龄化与财政负担**
- 5.5分原句：More and more people are getting old, which makes the government spend too much money on hospitals and pensions.
- 8.0分升格：**Demographic aging places an unprecedented fiscal strain on** public healthcare systems and state pension funds.

6. **严刑峻法与犯罪根源**
- 5.5分原句：Strict laws can scare bad people for a short time, but giving poor people education is the real way to stop crime.
- 8.0分升格：**While stringent penalties serve as** an immediate deterrent, **broadening access to** quality education and **alleviating** poverty **remain the fundamental remedies for** curbing crime rates.`,
  },
];

/**
 * Strips markdown syntax from note content to generate a clean single-line preview for the directory list.
 */
export function getCleanNoteExcerpt(content: string): string {
  const plain = content
    .replace(/^#+\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || '暂无正文内容...';
}

/**
 * Formats an ISO date string into compact Braun monospace MM.DD format (e.g. "10.28").
 */
export function formatCompactNoteDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '10.28';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}.${dd}`;
  } catch {
    return '10.28';
  }
}

/**
 * Calls deepseek-v4-pro to refine, structure, and expand the user's scattered notes or prompt instructions
 * into a structured Examiner Lecture Note (【核心公式 + 易错避坑 + Band 8.0 地道例句对照】).
 */
export async function expandNoteWithDeepSeek(params: {
  title: string;
  category: NoteCategory;
  content: string;
  apiKey: string;
  endpoint?: string;
}): Promise<{ title: string; content: string }> {
  const cleanKey = params.apiKey.trim();
  if (!cleanKey) {
    throw new Error('请先点击右上角齿轮图标配置 DeepSeek API Key。');
  }
  const cleanEndpoint =
    (params.endpoint || '').trim() || DEFAULT_DEEPSEEK_ENDPOINT;

  const systemPrompt = `你是一位资深雅思考官兼学术写作讲义主编。请基于用户当前笔记的【标题】、【所属分类】与【已有零散笔记或指令】，将其提炼扩写为一份结构严谨、干货满满、排版优雅的《雅思考官高分讲义手账》。

【排版与内容铁律（严禁彩色 Emoji）】：
1. **严禁使用任何彩色 Emoji 图标**，完全依靠清晰的层级标题与符号排版。
2. 讲义正文必须包含以下三大核心维度（使用 \`## 一、 ...\` 二级标题组织）：
   - **核心句型公式 / 逻辑骨架**：所有重点句型公式必须以 \`> FORMULA · ...\` 引用块（每行以 \`> \` 开头）呈现，以便前端渲染为左侧 2px 博朗橙竖线缩进。
   - **Band 5.5 vs Band 8.0 地道例句对照**：提供 2~4 组极具代表性的纯正英文例句或低分升格对比，**将英文例句中的核心高分词伙与升级结构用双星号 \`**高分词伙**\` 包裹**（以便前端自动渲染为博朗橙色高亮）。
   - **考官易错避坑指南（Common Pitfalls）**：用无序列表 \`- \` 一针见血指出中国考生最易犯的语法、搭配或审题误区。
3. 若原笔记标题为空或过于随意，请一并优化为一个专业、精炼的讲义标题。

请严格返回如下纯 JSON 对象（不要输出任何额外解释）：
{
  "title": "提炼后的专业讲义标题",
  "content": "使用上述 Markdown 规范排版的完整讲义正文（换行用 \\n）"
}`;

  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `所属分类：${params.category}\n当前标题：${
            params.title.trim() || '未命名雅思笔记'
          }\n当前笔记内容或扩写指令：\n${
            params.content.trim() ||
            `请围绕「${params.title.trim() || params.category}」生成一份包含核心句型公式、易错避坑与 Band 8.0 地道例句对照的考官级讲义。`
          }`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `DeepSeek AI 提炼扩写失败 (${response.status}): ${errText.slice(0, 120)}`
    );
  }

  const data = await response.json();
  const rawContent: string = data?.choices?.[0]?.message?.content || '';
  const parsed = extractAndParseJson(rawContent);

  const nextTitle = String(parsed.title || params.title || '考官核心讲义').trim();
  const nextContent = String(parsed.content || '').trim();

  if (!nextContent) {
    throw new Error('AI 未返回有效的讲义内容，请重试。');
  }

  return {
    title: nextTitle,
    content: nextContent,
  };
}
