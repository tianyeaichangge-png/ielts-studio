import { TextHighlightItem, VocabularyCard } from '../types/ielts';
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  deriveConciseMeaning,
  extractAndParseJson,
} from './geminiEvaluator';

export type MicroPracticeTaskGroup = 'T1' | 'T2';

export type MicroPracticeSubType =
  | 'dynamic'
  | 'static'
  | 'map'
  | 'process'
  | 'opinion'
  | 'discussion'
  | 'pros_cons'
  | 'report';

export interface MicroPracticeSubTypeMeta {
  key: MicroPracticeSubType;
  group: MicroPracticeTaskGroup;
  label: string;
  enCode: string;
}

export const MICRO_PRACTICE_SUBTYPES: MicroPracticeSubTypeMeta[] = [
  // T1 (图表)
  { key: 'dynamic', group: 'T1', label: '动态图', enCode: 'DYNAMIC' },
  { key: 'static', group: 'T1', label: '静态图', enCode: 'STATIC' },
  { key: 'map', group: 'T1', label: '地图', enCode: 'MAP' },
  { key: 'process', group: 'T1', label: '流程图', enCode: 'PROCESS' },
  // T2 (大作文)
  { key: 'opinion', group: 'T2', label: '观点类', enCode: 'OPINION' },
  { key: 'discussion', group: 'T2', label: '双边讨论', enCode: 'DISCUSSION' },
  { key: 'pros_cons', group: 'T2', label: '利弊类', enCode: 'PROS & CONS' },
  { key: 'report', group: 'T2', label: '报告类', enCode: 'REPORT' },
];

export interface MicroPracticeQuestion {
  id: string;
  group: MicroPracticeTaskGroup;
  subType: MicroPracticeSubType;
  chineseMeaning: string;
  rawLowBandSentence: string;
  targetWord?: string;
}

export interface MicroPracticeLexiconItem {
  word: string;
  pos: string;
  phonetic: string;
  meaning: string;
  fullMeaning: string;
  synonyms: string[];
  example: string;
}

export interface MicroPracticeEvaluation {
  band: number;
  diagnosis: string;
  band7Sentence: string;
  band7Highlights: string[];
  band8Sentence: string;
  structureFormula: string;
  lexicon: MicroPracticeLexiconItem[];
  highlights?: TextHighlightItem[];
}

export interface MicroPracticeHistoryRecord {
  id: string;
  timestamp: string;
  taskType: 'T1' | 'T2' | 'FREE';
  category: MicroPracticeSubType;
  questionId: string;
  chineseMeaning: string;
  rawSentence: string;
  targetWord?: string;
  userSentence: string;
  diagnosis: string;
  bandScore: number;
  band7Sentence: string;
  band8Sentence: string;
  structureFormula: string;
  lexicon: MicroPracticeLexiconItem[];
  highlights?: TextHighlightItem[];
}

/**
 * Built-in 24 high-frequency IELTS Micro-Practice Questions
 * (8 sub-types × 3 items = 24 questions, zero latency out-of-the-box)
 */
export const BUILTIN_MICRO_QUESTIONS: MicroPracticeQuestion[] = [
  // ==================== T1 · 动态图 (DYNAMIC) ====================
  {
    id: 'mp-t1-dynamic-1',
    group: 'T1',
    subType: 'dynamic',
    chineseMeaning:
      '从1990年到2020年，再生能源的消费量显著上升，而煤炭的使用量则持续下降。',
    rawLowBandSentence:
      'From 1990 to 2020, the consumption of renewable energy went up a lot, and the use of coal went down continuously.',
  },
  {
    id: 'mp-t1-dynamic-2',
    group: 'T1',
    subType: 'dynamic',
    chineseMeaning:
      '在最初的十年里保持稳定之后，私家车的数量在2015年突然激增并达到了顶峰。',
    rawLowBandSentence:
      'After staying the same for the first ten years, the number of private cars suddenly increased fast and reached the highest point in 2015.',
  },
  {
    id: 'mp-t1-dynamic-3',
    group: 'T1',
    subType: 'dynamic',
    chineseMeaning:
      '尽管中间有一些小幅波动，日本老年人口的比例预计将在2040年超过40%。',
    rawLowBandSentence:
      'Although there were some small ups and downs in the middle, the percentage of old people in Japan will be more than 40% in 2040.',
  },

  // ==================== T1 · 静态图 (STATIC) ====================
  {
    id: 'mp-t1-static-1',
    group: 'T1',
    subType: 'static',
    chineseMeaning:
      '在所有支出类别中，住房占家庭月平均预算的最大比例（35%），几乎是娱乐支出的三倍。',
    rawLowBandSentence:
      'Among all spending types, housing takes the biggest part of the family monthly budget at 35%, which is almost three times bigger than entertainment.',
  },
  {
    id: 'mp-t1-static-2',
    group: 'T1',
    subType: 'static',
    chineseMeaning:
      '选择计算机科学专业的男学生比例远高于女学生，两者分别为48%和14%。',
    rawLowBandSentence:
      'The percentage of boy students who choose computer science is much higher than girl students, and their numbers are 48% and 14%.',
  },
  {
    id: 'mp-t1-static-3',
    group: 'T1',
    subType: 'static',
    chineseMeaning:
      '相比之下，仅有一小部分受访者（不足8%）倾向于骑自行车通勤，位居所有交通方式之末。',
    rawLowBandSentence:
      'In contrast, only a very small group of people (less than 8%) like riding bikes to work, which is the last one in all transport ways.',
  },

  // ==================== T1 · 地图 (MAP) ====================
  {
    id: 'mp-t1-map-1',
    group: 'T1',
    subType: 'map',
    chineseMeaning:
      '原本位于城镇北部的大片农田被拆除了，取而代之的是一个现代化的商业购物中心和停车场。',
    rawLowBandSentence:
      'The big farmland in the north of the town was removed, and people built a modern shopping center and a car park in its place.',
  },
  {
    id: 'mp-t1-map-2',
    group: 'T1',
    subType: 'map',
    chineseMeaning:
      '主干道向东延伸并修建了一座横跨河流的新桥，这极大地改善了居民前往火车站的交通。',
    rawLowBandSentence:
      'The main road was made longer to the east and a new bridge was built over the river, making it much easier for people to go to the train station.',
  },
  {
    id: 'mp-t1-map-3',
    group: 'T1',
    subType: 'map',
    chineseMeaning:
      '图书馆西侧的旧工业仓库被改造成了文化艺术展馆，而周边的绿地面积则缩减了一半。',
    rawLowBandSentence:
      'The old factory warehouse on the west side of the library was changed into an art museum, while the green trees around it became half smaller.',
  },

  // ==================== T1 · 流程图 (PROCESS) ====================
  {
    id: 'mp-t1-process-1',
    group: 'T1',
    subType: 'process',
    chineseMeaning:
      '当粘土从地下挖掘出来后，首先会被送入金属格栅进行筛选，以剔除较大的石块与杂质。',
    rawLowBandSentence:
      'After people dig the clay out of the ground, they first put it onto a metal grid to remove the big stones and dirty things.',
  },
  {
    id: 'mp-t1-process-2',
    group: 'T1',
    subType: 'process',
    chineseMeaning:
      '随后，过滤后的液体在高温高压的发酵罐中静置48小时，然后再被输送至冷却塔。',
    rawLowBandSentence:
      'Next, the clean liquid stays in a very hot and high-pressure tank for 48 hours before workers send it to the cooling tower.',
  },
  {
    id: 'mp-t1-process-3',
    group: 'T1',
    subType: 'process',
    chineseMeaning:
      '一旦塑料瓶经过清洗、压碎并融化成颗粒，它们就会被重新塑造成全新的包装材料。',
    rawLowBandSentence:
      'Once the plastic bottles are washed, broken into small pieces and melted into small balls, people make them into new packing materials again.',
  },

  // ==================== T2 · 观点类 (OPINION) ====================
  {
    id: 'mp-t2-opinion-1',
    group: 'T2',
    subType: 'opinion',
    chineseMeaning:
      '如果大学只教授实用技能而忽视基础理论学科，社会将逐渐失去长远的科学突破与创新能力。',
    rawLowBandSentence:
      'If universities only teach useful job skills and ignore basic subjects, society will slowly lose the ability to make big scientific inventions in the future.',
  },
  {
    id: 'mp-t2-opinion-2',
    group: 'T2',
    subType: 'opinion',
    chineseMeaning:
      '向高糖饮料征收重税不仅能有效抑制肥胖率的上升，还能减轻公共医疗系统的财政负担。',
    rawLowBandSentence:
      'Putting high tax on sweet drinks can not only stop more and more people from getting fat, but also save money for public hospitals.',
  },
  {
    id: 'mp-t2-opinion-3',
    group: 'T2',
    subType: 'opinion',
    chineseMeaning:
      '一味追求经济增长而牺牲生态环境是一种短视的行为，最终会威胁人类自身的可持续生存。',
    rawLowBandSentence:
      'Only caring about making money and hurting the environment is a short-sighted action, and it will finally harm human survival in the future.',
  },

  // ==================== T2 · 双边讨论 (DISCUSSION) ====================
  {
    id: 'mp-t2-discussion-1',
    group: 'T2',
    subType: 'discussion',
    chineseMeaning:
      '虽然人工智能自动化会取代许多重复性的体力劳动岗位，但它同时也催生了对高技能数字人才的巨大需求。',
    rawLowBandSentence:
      'Although AI machines will take away many boring manual jobs, they also create a big need for workers with high computer skills.',
  },
  {
    id: 'mp-t2-discussion-2',
    group: 'T2',
    subType: 'discussion',
    chineseMeaning:
      '支持者认为远程办公赋予了员工更高的时间自由度，而反对者则担心这会削弱团队凝聚力与协作效率。',
    rawLowBandSentence:
      'Supporters think working from home gives workers more free time, while opponents worry that it will make teamwork and communication worse.',
  },
  {
    id: 'mp-t2-discussion-3',
    group: 'T2',
    subType: 'discussion',
    chineseMeaning:
      '尽管严格刑罚能在短期内震慑潜在犯罪分子，但普及教育与消除贫困才是降低犯罪率的治本之策。',
    rawLowBandSentence:
      'Even though strict punishment can scare bad people in a short time, giving better education and reducing poverty is the real way to stop crime.',
  },

  // ==================== T2 · 利弊类 (PROS & CONS) ====================
  {
    id: 'mp-t2-proscons-1',
    group: 'T2',
    subType: 'pros_cons',
    chineseMeaning:
      '国际旅游业的蓬勃发展虽然带动了当地就业与基础设施建设，但也往往造成传统文化商品化与生态恶化。',
    rawLowBandSentence:
      'Fast development of international tourism brings more local jobs and better roads, but it also makes traditional culture too commercial and damages nature.',
  },
  {
    id: 'mp-t2-proscons-2',
    group: 'T2',
    subType: 'pros_cons',
    chineseMeaning:
      '在线教育打破了地域限制并降低了学习成本，然而缺乏面对面互动容易导致自律性差的学生中途辍学。',
    rawLowBandSentence:
      'Online study removes place limits and costs less money, however no face-to-face talking makes students without self-control give up easily.',
  },
  {
    id: 'mp-t2-proscons-3',
    group: 'T2',
    subType: 'pros_cons',
    chineseMeaning:
      '人口老龄化虽然意味着医疗与养老金支出的剧增，但经验丰富的年长者依然能通过志愿服务与经验传承回馈社会。',
    rawLowBandSentence:
      'An aging population means spending much more money on healthcare and pensions, but old people with rich experience can still help society by volunteering.',
  },

  // ==================== T2 · 报告类 (REPORT) ====================
  {
    id: 'mp-t2-report-1',
    group: 'T2',
    subType: 'report',
    chineseMeaning:
      '大城市住房严重短缺的主要原因是农村人口快速向都市涌入，以及投机性房地产投资推高了房价。',
    rawLowBandSentence:
      'The main reason why big cities do not have enough houses is that rural people move to cities too fast and rich people buy many houses to make money.',
  },
  {
    id: 'mp-t2-report-2',
    group: 'T2',
    subType: 'report',
    chineseMeaning:
      '现代人工作压力剧增不仅源于激烈的职场竞争，还因为智能手机让人们在下班后也难以摆脱工作消息的打扰。',
    rawLowBandSentence:
      'Modern people feel much more stressed at work not only because job competition is fierce, but also because smartphones make them work even after leaving the office.',
  },
  {
    id: 'mp-t2-report-3',
    group: 'T2',
    subType: 'report',
    chineseMeaning:
      '为了扭转生物多样性丧失的趋势，政府应当立法建立自然保护区，并对非法排污企业处以严厉的经济处罚。',
    rawLowBandSentence:
      'To stop animals and plants from dying out, the government should make laws to build nature parks and fine factories that pollute the environment heavily.',
  },
];

/**
 * Picks a candidate vocabulary card from the user's 'learning' (待攻克) or 'writing' (写作积累) box
 * that best fits the current Task 1 or Task 2 context.
 */
export function pickCandidateWordForMicroPractice(
  cards: VocabularyCard[],
  group: MicroPracticeTaskGroup,
  excludeWord?: string
): VocabularyCard | null {
  if (!cards || cards.length === 0) return null;
  const excludeLower = (excludeWord || '').trim().toLowerCase();

  const isLearningOrWriting = (c: VocabularyCard) =>
    c.status === 'learning' ||
    c.status === 'vague' ||
    c.vocabCategory === 'writing' ||
    c.fromWriting ||
    c.isCustom;

  const targetCat = group === 'T1' ? 'task1' : 'task2';

  // Priority 1: 'learning' or 'writing' cards that aren't mastered
  const priorityPool = cards.filter(
    (c) =>
      c.status !== 'mastered' &&
      c.word.trim().toLowerCase() !== excludeLower &&
      (isLearningOrWriting(c) || c.vocabCategory === targetCat)
  );

  const fallbackPool = cards.filter(
    (c) =>
      c.status !== 'mastered' && c.word.trim().toLowerCase() !== excludeLower
  );

  const pool =
    priorityPool.length > 0
      ? priorityPool
      : fallbackPool.length > 0
      ? fallbackPool
      : cards;

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] || null;
}

/**
 * AI Dynamic Question Generation ('deepseek-v4-flash')
 * Combines a vocabulary word from the user's wordbook with the active subType context
 * to generate { chineseMeaning, rawLowBandSentence, targetWord }.
 */
export async function generateVocabMicroQuestion(params: {
  group: MicroPracticeTaskGroup;
  subTypeMeta: MicroPracticeSubTypeMeta;
  targetCard: VocabularyCard;
  apiKey: string;
  endpoint?: string;
}): Promise<MicroPracticeQuestion> {
  const cleanKey = params.apiKey.trim();
  if (!cleanKey) {
    throw new Error('请先点击右上角齿轮图标配置 DeepSeek API Key。');
  }
  const cleanEndpoint =
    (params.endpoint || '').trim() || DEFAULT_DEEPSEEK_ENDPOINT;

  const systemPrompt = `你是一位资深雅思写作命题专家。请结合给定的【目标生词】与当前【雅思题型分类】，生成一道用于「5.5分低分病句升格训练」的单句改写题。
【要求】：
1. "chineseMeaning": 一句地道、符合雅思 ${
    params.group === 'T1' ? 'Task 1 图表客观描述' : 'Task 2 学术议论文论证'
  }（细分题型：${params.subTypeMeta.label}）语境的中文原意（25~45字）。这句中文的语义必须天然适合用上目标词 "${
    params.targetCard.word
  }"（词义：${params.targetCard.meaning || params.targetCard.chineseMeaning}）。
2. "rawLowBandSentence": 对应这句中文的 **Band 5.5 低分英文原句**（使用大白话、简单句或中式平铺直叙表达，**故意不要直接使用目标词 "${
    params.targetCard.word
  }"**，以便考生练习用目标词将其改写升级为高分句）。
3. "targetWord": 原样返回 "${params.targetCard.word}"。

只返回如下纯 JSON 对象（不要输出任何额外解释）：
{
  "chineseMeaning": "...",
  "rawLowBandSentence": "...",
  "targetWord": "${params.targetCard.word}"
}`;

  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `题型：${params.group} · ${params.subTypeMeta.label} (${params.subTypeMeta.enCode})\n目标生词：${params.targetCard.word} (${params.targetCard.partOfSpeech} ${params.targetCard.meaning || params.targetCard.chineseMeaning})`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `DeepSeek 出题请求失败 (${response.status}): ${errText.slice(0, 120)}`
    );
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  const parsed = extractAndParseJson(content);

  const chineseMeaning = String(parsed.chineseMeaning || '').trim();
  const rawLowBandSentence = String(parsed.rawLowBandSentence || '').trim();
  const targetWord = String(
    parsed.targetWord || params.targetCard.word
  ).trim();

  if (!chineseMeaning || !rawLowBandSentence) {
    throw new Error('AI 生成的题目格式不完整，请重试。');
  }

  return {
    id: `mp-vocab-${Date.now()}`,
    group: params.group,
    subType: params.subTypeMeta.key,
    chineseMeaning,
    rawLowBandSentence,
    targetWord,
  };
}

/**
 * Examiner 3-Tier Sentence Evaluation ('deepseek-v4-pro')
 * Outputs:
 * 1. DIAGNOSIS · 诊断 (with band score e.g. 6.0, <= 40 chars incisive critique)
 * 2. BAND 7.0 · 顺畅修改 (keeps user skeleton, marks key upgraded words with **...** for #EA5B25 text highlight)
 * 3. BAND 8.0 · 高分重写 (nominalization / participle / advanced clause + STRUCTURE formula)
 * 4. LEXICON · 重点词伙 (1~2 core collocations with both concise meaning & fullMeaning for 1-click ingestion)
 */
export async function evaluateMicroPracticeSentence(params: {
  group: MicroPracticeTaskGroup;
  subTypeMeta: MicroPracticeSubTypeMeta;
  isFreeRewrite: boolean;
  question?: MicroPracticeQuestion;
  userSentence: string;
  apiKey: string;
  endpoint?: string;
}): Promise<MicroPracticeEvaluation> {
  const cleanKey = params.apiKey.trim();
  if (!cleanKey) {
    throw new Error('请先点击右上角齿轮图标配置 DeepSeek API Key。');
  }
  const cleanEndpoint =
    (params.endpoint || '').trim() || DEFAULT_DEEPSEEK_ENDPOINT;

  const systemPrompt = `你是一位铁面无私、崇尚极简精准的雅思考官（Senior IELTS Writing Examiner）兼《雅思学术双解词典》主编。
请对考生提交的单句练习进行「三阶升格批改」，严格返回纯 JSON 对象：

1. "band": 对考生原句的真实雅思单句评分（0.5分进制，如 5.5, 6.0, 6.5, 7.0）。
2. "diagnosis": 一句话一针见血指出考生句子中的语法瑕疵、中式表达或句式单薄点（**严格控制在 40 字以内**，拒绝任何客套与废话！）。
3. "band7Sentence": 【BAND 7.0 · 顺畅修改】保留考生原有的句式骨架，仅做地道词伙替换与语法微调。**必须将句中 1~3 处关键升级词伙用双星号 \`**词伙**\` 包裹**（以便前端渲染为博朗橙文字）。
4. "band8Sentence": 【BAND 8.0 · 高分重写】使用名词化（Nominalization）、分词构句、无灵主语或高阶从句彻底重写为考官级示范句（同样可将核心亮点结构用 \`**...**\` 包裹）。
5. "structureFormula": 提炼 Band 8.0 重写句的句型结构公式（如 "While [从句对比], [名词化主语] + witness + [宾语]" 或 "Attributed to [名词化原因], [主句结果], thereby [分词结果状语]"）。
6. "lexicon": 从本次重写中提取 **1~2 个**最核心的雅思高分词伙或学术单词，供考生一键入库背诵。每项必须包含：
   - "word": 英文词伙或单词（如 "witness a pronounced surge" 或 "disproportionately"）；
   - "pos": 准确词性（如 "phrase"、"v. / n."、"adj."、"adv."，严禁填 "acad."）；
   - "phonetic": 若为单个单词提供英式 IPA 音标（如 "/ˌdɪsprəˈpɔːʃənətli/"），若为多词短语必须填 ""；
   - "meaning": **精简中文释义**（严格控制在 12~18 字以内，不带括号，如 "见证显著激增"）；
   - "fullMeaning": **全义项词典释义**（详列核心词性义项、熟词僻义与固定搭配，用 " | " 分隔不同维度）；
   - "synonyms": 2 个地道雅思同义替换词数组；
   - "example": Band 8.0 重写句（去除星号标记后的纯文本）。

只返回如下纯 JSON 对象：
{
  "band": 6.0,
  "diagnosis": "动词搭配单薄且并列分句缺乏高阶从句衔接，带有明显口语化痕迹。",
  "band7Sentence": "From 1990 to 2020, renewable energy consumption **experienced a notable rise**, whereas coal usage **declined steadily**.",
  "band8Sentence": "The period between 1990 and 2020 **witnessed a pronounced surge** in renewable energy consumption, **accompanied by a persistent downward trajectory** in coal utilization.",
  "structureFormula": "[时间段无灵主语] + witness + [名词化趋势], accompanied by + [伴随分词对比]",
  "lexicon": [
    {
      "word": "witness a pronounced surge",
      "pos": "phrase",
      "phonetic": "",
      "meaning": "见证显著激增",
      "fullMeaning": "phrase 见证显著激增；目睹大幅增长 | 常见主语：The period / decade / country",
      "synonyms": ["experience a marked escalation", "undergo a sharp upward trend"],
      "example": "The period between 1990 and 2020 witnessed a pronounced surge in renewable energy consumption."
    }
  ]
}`;

  const userContext = params.isFreeRewrite
    ? `【自由改写模式】\n题型语境：${params.group} · ${params.subTypeMeta.label}\n考生待升级原句：${params.userSentence.trim()}`
    : `【命题改写模式】\n题型：${params.group} · ${params.subTypeMeta.label} (${params.subTypeMeta.enCode})\n中文原意：${params.question?.chineseMeaning || ''}\n5.5分参考原句：${params.question?.rawLowBandSentence || ''}${
        params.question?.targetWord
          ? `\n要求使用的目标生词 (TARGET)：${params.question.targetWord}`
          : ''
      }\n考生提交的改写句：${params.userSentence.trim()}`;

  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      temperature: 0.35,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContext },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `DeepSeek 批改请求失败 (${response.status}): ${errText.slice(0, 120)}`
    );
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  const parsed = extractAndParseJson(content);

  const rawBand = Number(parsed.band);
  const band =
    !Number.isNaN(rawBand) && rawBand >= 1 && rawBand <= 9
      ? Math.round(rawBand * 2) / 2
      : 6.0;

  const rawDiagnosis = String(parsed.diagnosis || '').trim();
  const diagnosis =
    rawDiagnosis.length > 46 ? `${rawDiagnosis.slice(0, 44)}。` : rawDiagnosis;

  const band7Sentence = String(parsed.band7Sentence || '').trim();
  const band8Sentence = String(parsed.band8Sentence || '').trim();
  const cleanBand8Plain = band8Sentence.replace(/\*\*/g, '');
  const structureFormula = String(parsed.structureFormula || '').trim();

  const rawLexicon = Array.isArray(parsed.lexicon) ? parsed.lexicon : [];
  const lexicon: MicroPracticeLexiconItem[] = rawLexicon
    .slice(0, 2)
    .map((item: Record<string, unknown>) => {
      const word = String(item.word || '').trim();
      const pos = String(item.pos || (word.includes(' ') ? 'phrase' : 'n.')).trim();
      const phonetic = word.includes(' ')
        ? ''
        : String(item.phonetic || '').trim();
      const rawMeaning = String(item.meaning || '').trim();
      const concise = deriveConciseMeaning(rawMeaning || '高分学术词伙');
      const fullMeaning = String(item.fullMeaning || concise).trim();
      const synonyms = Array.isArray(item.synonyms)
        ? item.synonyms.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const example = String(item.example || cleanBand8Plain).trim();
      return {
        word,
        pos,
        phonetic,
        meaning: concise,
        fullMeaning,
        synonyms,
        example,
      };
    })
    .filter((item: MicroPracticeLexiconItem) => Boolean(item.word));

  return {
    band,
    diagnosis: diagnosis || '句式结构偏口语化，建议强化学术名词化与从句衔接。',
    band7Sentence,
    band7Highlights: Array.isArray(parsed.band7Highlights)
      ? parsed.band7Highlights.map((s: unknown) => String(s))
      : [],
    band8Sentence,
    structureFormula:
      structureFormula || '[学术主语/名词化短语] + [精准谓语词伙] + [从句/分词修饰]',
    lexicon,
  };
}
