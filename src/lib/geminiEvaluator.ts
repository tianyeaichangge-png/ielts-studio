import { WritingEvaluationReport, WritingTaskType } from '../types/ielts';

export const DEFAULT_DEEPSEEK_ENDPOINT =
  'https://api.deepseek.com/chat/completions';

interface EvaluateWritingParams {
  taskType: WritingTaskType;
  prompt: string;
  essay: string;
  apiKey: string;
  endpoint?: string;
  model?: string;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function roundToHalfBand(score: number): number {
  const clamped = Math.max(1, Math.min(9, score));
  return Math.round(clamped * 2) / 2;
}

/**
 * Converts a File or Clipboard Blob into a crisp, storage-friendly Base64 Data URL
 * suitable for localStorage persistence and lightbox inspection.
 */
export function convertImageFileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(rawDataUrl);
      img.onload = () => {
        const maxDim = 1440;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export async function evaluateIeltsWriting({
  taskType,
  prompt,
  essay,
  apiKey,
  endpoint = DEFAULT_DEEPSEEK_ENDPOINT,
  model = 'deepseek-chat',
}: EvaluateWritingParams): Promise<WritingEvaluationReport> {
  const wordCount = countWords(essay);
  const cleanKey = apiKey.trim();
  const cleanEndpoint = endpoint.trim() || DEFAULT_DEEPSEEK_ENDPOINT;

  if (!cleanKey) {
    throw new Error('MISSING_API_KEY');
  }

  const isTask1 = taskType === 'task1';
  const minWords = isTask1 ? 150 : 250;

  const taskSpecificGuidelines = isTask1
    ? `当前为【IELTS Academic Writing Task 1（图表小作文，最低150词）】。
请将第一项评分维度严格设定为 **Task Achievement (TA)**，并重点围绕以下小作文核心标准进行考官级诊断：
1. **TA (Task Achievement 任务完成度)**：重点检查是否包含独立且合格的 **Overview（总体趋势/核心极值概括段，且不混杂机械细节数据）**；是否准确提炼了图表的关键特征（极值、转折点、交点、起止点）；字数是否满 150 词。
2. **CC (Coherence and Cohesion 逻辑连贯与衔接)**：数据分段是否具备清晰的归类逻辑（如按趋势分组、按对比对象分组或按时间阶段分段）；句间及段间对比过渡词（By contrast, Meanwhile, Respectively）是否自然准确。
3. **LR (Lexical Resource 词汇丰富度与同义替换)**：重点评估 **动态趋势词**（如 surge, skyrocket, plummet, witness a steady upward trajectory, plateau）与 **静态占比/倍差表达**（如 account for the lion's share, outstrip, pale in comparison, a threefold increase）的丰富度与精准度，并在 paraphrasingUpgrades 中给出针对图表趋势与数据表达的地道升级替换。
4. **GRA (Grammatical Range and Accuracy 语法多样性与数据句式修正)**：重点检查静态/动态比较句式（twice as high as, whereas, while）、分词伴随状语（peaking at..., followed by a slight dip to...）、被动语态（流程图/地图题）及过去/将来时态与数据介词（at, by, to, of）的准确度。`
    : `当前为【IELTS Academic Writing Task 2（议论文大作文，最低250词）】。
请将第一项评分维度严格设定为 **Task Response (TR)**，并重点围绕以下大作文核心标准进行考官级诊断：
1. **TR (Task Response 任务回应与立意)**：是否精准回应题干所有设问；总论点（Thesis Statement）立场是否始终如一；主体段分论点是否具备充分的因果链条推导与具体例证支持。
2. **CC (Coherence and Cohesion 逻辑连贯与衔接)**：四段/五段式结构是否均衡；每段 Topic Sentence 是否清晰；指代衔接与逻辑递进/让步转折是否自然。
3. **LR (Lexical Resource 学术词汇丰富度与同义替换)**：学术书面语体（Academic Register）、话题高阶词伙搭配（Collocations），并在 paraphrasingUpgrades 中给出 3-5 组同义替换升级。
4. **GRA (Grammatical Range and Accuracy 语法多样性与标红修正)**：复杂从句、非谓语结构、虚拟语气或倒装句的多样性及语法准确性。`;

  const systemInstruction = `你是一位拥有15年雅思考官经验的资深学术写作评审官（Senior IELTS Writing Examiner）。
请严格依据剑桥雅思官方评分标准（IELTS Writing Band Descriptors）对考生的作文进行深度诊断批改，并以 JSON 格式（json_object）输出完整评分报告。

${taskSpecificGuidelines}
考生当前作文字数：${wordCount} 词（官方最低建议：${minWords} 词）。

请严格返回符合以下 JSON 结构的纯 JSON 对象（不要输出任何 JSON 以外的解释文字）：
{
  "overallBand": 7.0,
  "trTa": {
    "band": 7.0,
    "summary": "针对 ${isTask1 ? 'Task Achievement (TA：重点点评 Overview 总体趋势概括与关键数据特征筛选)' : 'Task Response (TR：重点点评审题立意与论证深度)'} 的核心考官评语（中文）",
    "strengths": ["亮点1", "亮点2"],
    "improvements": ["改进建议1", "改进建议2"]
  },
  "cc": {
    "band": 7.0,
    "summary": "针对 Coherence and Cohesion (逻辑分段与衔接) 的核心考官评语（中文）",
    "strengths": ["亮点1", "亮点2"],
    "improvements": ["改进建议1", "改进建议2"]
  },
  "lr": {
    "band": 7.0,
    "summary": "针对 Lexical Resource (${isTask1 ? '动态趋势词、静态对比表达与数据修饰词丰富度' : '学术词汇丰富度与同义替换'}) 的核心考官评语（中文）",
    "strengths": ["亮点1", "亮点2"],
    "improvements": ["改进建议1", "改进建议2"],
    "paraphrasingUpgrades": [
      {
        "original": "摘自考生原文的普通/重复词汇或数据表达",
        "upgraded": "地道雅思7.5+高分同义替换词或短语（如 indispensable / paramount）",
        "chineseMeaning": "该高分替换词的简明中文释义（如：不可或缺的；至关重要的）",
        "contextExplanation": "为什么这样替换更地道、更符合雅思学术语境"
      }
    ]
  },
  "gra": {
    "band": 7.0,
    "summary": "针对 Grammatical Range and Accuracy (${isTask1 ? '静态对比句式、数据介词搭配与时态准确度' : '语法多样性与错误修正'}) 的核心考官评语（中文）",
    "strengths": ["亮点1", "亮点2"],
    "improvements": ["改进建议1", "改进建议2"],
    "errorCorrections": [
      {
        "original": "摘自考生原文含有语法瑕疵、介词误用或句式单薄的原句片段",
        "corrected": "修正并升级后的地道雅思学术句式",
        "keyExpression": "该修正句中最值得背诵的核心高分学术词伙或短语（如 warrant closer scrutiny）",
        "chineseMeaning": "该核心高分词伙的简明中文释义（如：值得更严密的审视）",
        "errorType": "修正类型（如：趋势介词修正 / 静态对比句式升级 / 分词伴随结构）",
        "explanation": "具体的语法修正解析与提分点说明"
      }
    ]
  },
  "improvedSampleParagraph": "选取考生作文中最核心的一段（${isTask1 ? '如 Overview 段或核心数据对比主体段' : '核心论证主体段'}），重写为 Band 8.0 考官示范段落（全英文）",
  "examinerSummary": "总结性的备考冲刺建议（中文，2-3句话指明下一步提分关键）"
}

要求：
1. 所有 band 分数必须是 0.5 的倍数（例如 5.5, 6.0, 6.5, 7.0, 7.5, 8.0）。
2. paraphrasingUpgrades 至少提供 3-5 组原文词汇/数据表达同义替换升级。
3. errorCorrections 至少提供 3-4 处原文句子标红修正或高阶句式升级对照。`;

  const userContent = `请对以下雅思 ${
    isTask1 ? 'Task 1 小作文' : 'Task 2 大作文'
  } 进行四维精批并返回 JSON 对象：\n\n【雅思写作题目 Prompt】:\n${prompt}\n\n【考生作文 Essay (${wordCount} words)】:\n${essay}`;

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content: systemInstruction,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    response_format: {
      type: 'json_object',
    },
    stream: false,
  };

  if (model !== 'deepseek-reasoner') {
    requestBody.temperature = 0.35;
  }

  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail =
        errJson?.error?.message || errJson?.message || errorDetail;
    } catch {
      // ignore parse error
    }
    throw new Error(`DeepSeek API 调用失败: ${errorDetail}`);
  }

  const data = await response.json();
  const messageObj = data?.choices?.[0]?.message;
  const rawText: string = messageObj?.content || '';
  const reasoningContent: string | undefined =
    typeof messageObj?.reasoning_content === 'string'
      ? messageObj.reasoning_content.trim()
      : undefined;

  if (!rawText) {
    throw new Error('DeepSeek API 返回内容为空，请重试或检查模型与 Endpoint 配置。');
  }

  const cleanedJson = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleanedJson);

  const trBand = roundToHalfBand(Number(parsed?.trTa?.band ?? 6.5));
  const ccBand = roundToHalfBand(Number(parsed?.cc?.band ?? 6.5));
  const lrBand = roundToHalfBand(Number(parsed?.lr?.band ?? 6.5));
  const graBand = roundToHalfBand(Number(parsed?.gra?.band ?? 6.5));
  const calculatedOverall = roundToHalfBand(
    Number(parsed?.overallBand ?? (trBand + ccBand + lrBand + graBand) / 4)
  );

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    taskType,
    prompt,
    essay,
    wordCount,
    overallBand: calculatedOverall,
    trTa: {
      band: trBand,
      summary: parsed?.trTa?.summary || '已完成任务完成度诊断。',
      strengths: Array.isArray(parsed?.trTa?.strengths) ? parsed.trTa.strengths : [],
      improvements: Array.isArray(parsed?.trTa?.improvements) ? parsed.trTa.improvements : [],
    },
    cc: {
      band: ccBand,
      summary: parsed?.cc?.summary || '已完成连贯与衔接度诊断。',
      strengths: Array.isArray(parsed?.cc?.strengths) ? parsed.cc.strengths : [],
      improvements: Array.isArray(parsed?.cc?.improvements) ? parsed.cc.improvements : [],
    },
    lr: {
      band: lrBand,
      summary: parsed?.lr?.summary || '已完成词汇丰富度与同义替换诊断。',
      strengths: Array.isArray(parsed?.lr?.strengths) ? parsed.lr.strengths : [],
      improvements: Array.isArray(parsed?.lr?.improvements) ? parsed.lr.improvements : [],
      paraphrasingUpgrades: Array.isArray(parsed?.lr?.paraphrasingUpgrades)
        ? parsed.lr.paraphrasingUpgrades
        : [],
    },
    gra: {
      band: graBand,
      summary: parsed?.gra?.summary || '已完成语法多样性与准确性诊断。',
      strengths: Array.isArray(parsed?.gra?.strengths) ? parsed.gra.strengths : [],
      improvements: Array.isArray(parsed?.gra?.improvements) ? parsed.gra.improvements : [],
      errorCorrections: Array.isArray(parsed?.gra?.errorCorrections)
        ? parsed.gra.errorCorrections
        : [],
    },
    improvedSampleParagraph:
      parsed?.improvedSampleParagraph ||
      'Overall, it is evident that renewable energy generation experienced a pronounced upward trajectory across all surveyed nations, with Sweden consistently commanding the largest share.',
    examinerSummary:
      parsed?.examinerSummary ||
      '整体结构清晰，建议进一步丰富数据对比句式与趋势动词的同义替换。',
    reasoningSummary: reasoningContent,
    sourceMode: 'deepseek',
  };
}

/**
 * Local Offline Diagnostic Generator (Adaptive for Task 1 vs Task 2)
 */
export function generateOfflineDiagnosticReport(
  taskType: WritingTaskType,
  prompt: string,
  essay: string
): WritingEvaluationReport {
  const isTask1 = taskType === 'task1';
  const wordCount = countWords(essay);
  const sentences = essay
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const minWords = isTask1 ? 150 : 250;
  const lengthPenalty = wordCount < minWords ? -0.5 : 0;

  const hasOverviewSignal = /overall|in general|generally speaking|it is clear that|it is evident that/i.test(
    essay
  );
  const hasAdvancedVocab =
    /mitigate|ubiquitous|exacerbate|detrimental|indispensable|disparity|catalyst|proliferate|trajectory|outstrip|skyrocket|proportion|respectively|albeit/i.test(
      essay
    );

  const baseScore = hasAdvancedVocab ? 7.0 : 6.0;
  const trBand = roundToHalfBand(
    baseScore + lengthPenalty + (isTask1 && !hasOverviewSignal ? -0.5 : 0)
  );
  const ccBand = roundToHalfBand(baseScore + 0.5);
  const lrBand = roundToHalfBand(hasAdvancedVocab ? 7.5 : 6.5);
  const graBand = roundToHalfBand(baseScore);
  const overallBand = roundToHalfBand((trBand + ccBand + lrBand + graBand) / 4);

  const firstSentence =
    sentences[0] ||
    (isTask1
      ? 'The chart shows the changes in different categories over the period.'
      : 'Many people think this topic is very important in modern society.');
  const secondSentence =
    sentences[1] ||
    (isTask1
      ? 'The number increased a lot from 2000 to 2020.'
      : 'There are many reasons why governments should pay attention to this problem.');

  if (isTask1) {
    return {
      id: `report-${Date.now()}`,
      createdAt: new Date().toISOString(),
      taskType: 'task1',
      prompt,
      essay,
      wordCount,
      overallBand,
      trTa: {
        band: trBand,
        summary: hasOverviewSignal
          ? `【TA 任务完成度诊断】文章包含明确的 Overview 总体趋势概括（全文 ${wordCount} 词），较好地提炼了图表的核心极值与整体走向。建议在主体段进一步强化不同对象之间的横向交点与倍差对比，避免机械罗列流水账数据。`
          : `【TA 任务完成度诊断】当前文章（${wordCount} 词）缺乏标志性的独立 Overview（总体趋势概括段，通常以 Overall, it is evident that... 领起）。在雅思 Task 1 评分标准中，缺少清晰的 Overview 会直接限制 TA 维度冲击 7.0+。`,
        strengths: [
          '首段准确改写了图表题干背景（Paraphrasing），交代了统计对象与时间跨度',
          hasOverviewSignal
            ? '具备清晰的 Overview 宏观趋势总结，未在总结段堆砌琐碎数字'
            : '关键起止点与极值数据有所提及',
        ],
        improvements: [
          '在描写完单条趋势后，务必使用 while / whereas / by contrast 衔接另一组数据的横向对比',
          wordCount < 150
            ? `当前字数（${wordCount} 词）未达 Task 1 官方 150 词下限，请补充关键极值与倍差细节`
            : '次要数据可通过括号或 merged clauses（合并从句）一笔带过，突出主要特征',
        ],
      },
      cc: {
        band: ccBand,
        summary:
          '图表信息分段层次清晰，能够按照“引言改写 — Overview 总体特征 — 细节分组对比”推进。过渡连接词与指代词（respectively, the former, the latter）运用较为得体。',
        strengths: [
          '主体段按数据趋势/类别进行了合理聚类，可读性强',
          '对比衔接词使用自然，未出现生硬的机械罗列',
        ],
        improvements: [
          '善用 respectively（分别地）与定语从句合并同类数据，减少重复主语',
        ],
      },
      lr: {
        band: lrBand,
        summary:
          '已掌握基础的上升/下降趋势词与占比表达。为冲击 7.0+，需进一步丰富【动态趋势动词 + 程度副词】以及【静态倍差/份额同义替换】，避免全文重复使用 increase, decrease, show。',
        strengths: [
          '百分比与时间段表达准确，未出现严重的词汇误用',
        ],
        improvements: [
          '用 witness a dramatic surge / skyrocket / plateau 替换高频重复的 increase / stay the same',
          '增加约数修饰语（approximately, marginally above, just under）体现严谨的学术数据语感',
        ],
        paraphrasingUpgrades: [
          {
            original: 'increased a lot / went up quickly',
            upgraded: 'surged dramatically / experienced a pronounced upward trajectory',
            chineseMeaning: '急剧飙升；经历了显著的上升轨迹',
            contextExplanation: '动态图表描述大幅上升时，名词化短语或 surge dramatically 能显著拉开词汇档次。',
          },
          {
            original: 'had the largest percentage',
            upgraded: "accounted for the lion's share / commanded the highest proportion",
            chineseMeaning: '占据最大份额；拥有最高占比',
            contextExplanation: '静态对比最大占比时，account for 与 command the highest proportion 是考官高频地道搭配。',
          },
          {
            original: 'stayed the same',
            upgraded: 'reached a plateau / remained relatively stable',
            chineseMeaning: '进入平稳期（高原期）；保持相对稳定',
            contextExplanation: '描述数据平稳或高位企稳时，plateau 比 stay the same 更加精准地道。',
          },
        ],
      },
      gra: {
        band: graBand,
        summary:
          '基本掌握过去时态与比较级结构，但在“独立主格/分词伴随补充具体数值”以及“静态倍差比较句型”的多样性上仍有提升空间。',
        strengths: [
          '时态与图表时间轴对应基本准确',
        ],
        improvements: [
          '多采用“主句描述趋势 + 逗号 + peaking at X% / standing at Y%”的分词伴随结构',
          '注意介词搭配区分：increase by（净增幅度）vs. increase to（增至某数值）vs. stand at（位于某数值）',
        ],
        errorCorrections: [
          {
            original: firstSentence,
            corrected:
              'The provided chart illustrates the trajectory and relative proportions of the surveyed categories over the specified period.',
            keyExpression: 'illustrate the trajectory and relative proportions',
            chineseMeaning: '展示……的变化轨迹与相对占比',
            errorType: '首段题干改写升级 (Opening Paraphrase)',
            explanation: '使用 illustrate the trajectory and relative proportions 替代简单的 show the changes，学术感更强。',
          },
          {
            original: secondSentence,
            corrected:
              'The figure witnessed a nearly threefold surge between 2000 and 2020, peaking at 68% at the end of the period.',
            keyExpression: 'witness a threefold surge, peaking at...',
            chineseMeaning: '经历了近三倍的激增，并在……达到峰值',
            errorType: '动态趋势 + 分词伴随数据句式 (Trend & Participle)',
            explanation: '结合 witnessed a threefold surge 与 peaking at... 分词结构，在一句话内同时完成趋势定性与极值定量报告。',
          },
          {
            original: 'Category A was 40%, and Category B was 20%.',
            corrected:
              'Category A stood at 40%, which was twice as high as the figure for Category B (20%).',
            keyExpression: 'twice as high as the figure for...',
            chineseMeaning: '是……数值的两倍之高（静态倍差比较）',
            errorType: '静态倍差对比句式 (Static Comparison)',
            explanation: '切忌孤立报数，使用 twice as high as the figure for... 建立数据之间的横向比较关系。',
          },
        ],
      },
      improvedSampleParagraph:
        'Overall, it is evident that all surveyed categories experienced an upward trajectory over the timeframe, albeit at varying paces. While Category A consistently commanded the largest share throughout the period, Category B demonstrated the most dramatic surge during the final decade.',
      examinerSummary:
        'Task 1 提分关键：确保 Overview 段清晰概括“整体趋势 + 最大/最小极值”，并在主体段多用横向对比句式（twice as high as / outstrip）取代流水账报数。',
      sourceMode: 'demo-engine',
    };
  }

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    taskType: 'task2',
    prompt,
    essay,
    wordCount,
    overallBand,
    trTa: {
      band: trBand,
      summary: `文章切题度良好（当前字数 ${wordCount} 词），立场表达清晰。主体段能够围绕核心论点展开，但在第二个分论点的因果推导链条上略显跳跃，建议增加具体例证或反面假设论证。`,
      strengths: [
        '开篇成功进行了题目背景改写（Paraphrasing），立场鲜明不模棱两可',
        wordCount >= minWords
          ? `篇幅充实（${wordCount} 词），满足并超过雅思官方 ${minWords} 词的字数基准线`
          : '核心论点方向紧扣题干设问，未出现偏题现象',
      ],
      improvements: [
        wordCount < minWords
          ? `当前字数（${wordCount} 词）未达到 ${minWords} 词官方下限，会在 TR 维度触发扣分，请务必扩充主体段论证细节`
          : '主体段在提出 Topic Sentence 后，建议采用“解释机理 → 具体例证 → 扣回分论点”的三步扩展法',
      ],
    },
    cc: {
      band: ccBand,
      summary:
        '段落划分合理，具备清晰的“引言 — 主体段 — 结论”四段/五段式学术骨架。句间逻辑连接词使用较为自然，未出现过度机械堆砌首先、其次的现象。',
      strengths: [
        '段落内部主题句（Topic Sentence）领起作用明确，考官可快速抓取各段核心意群',
      ],
      improvements: [
        '部分句间衔接仍依赖显性连接副词，建议多使用指示代词（this tendency / such measures）实现隐性语义粘连',
      ],
    },
    lr: {
      band: lrBand,
      summary:
        '具备良好的学术词汇意识，能够尝试使用高阶动词与形容词修饰名词短语。但部分高频概念在全文中存在同词复现，可通过高分同义替换（Paraphrasing）进一步拉开词汇档次。',
      strengths: [
        '能够脱离口语化表达，展现出一定的学术书面语（Academic Register）功底',
      ],
      improvements: [
        '避免在同一段落重复使用 important, problem, good/bad, more and more 等基础词汇',
      ],
      paraphrasingUpgrades: [
        {
          original: 'important / very necessary',
          upgraded: 'indispensable / paramount',
          chineseMeaning: '不可或缺的；至关重要的',
          contextExplanation: '在强调核心地位或政策必要性时，用 indispensable 替代 important 可直接体现 C1 级词汇量。',
        },
        {
          original: 'make the problem worse',
          upgraded: 'exacerbate / aggravate the predicament',
          chineseMeaning: '加剧；使困境恶化',
          contextExplanation: '议论文探讨负面效应时，exacerbate（加剧）与 mitigate（缓解）是考官最青睐的高分学术动词。',
        },
        {
          original: 'have a bad effect on',
          upgraded: 'exert a detrimental impact on',
          chineseMeaning: '对……产生不利/有害的影响',
          contextExplanation: '使用 exert a detrimental impact on 显著提升学术语体正式感。',
        },
      ],
    },
    gra: {
      band: graBand,
      summary:
        '句型结构兼具简单句与复合句，定语从句与状语从句运用较为娴熟。部分长难句在冠词限定、主谓一致或非谓语分词衔接上仍有打磨空间。',
      strengths: [
        '能够使用让步状语从句（While/Although）与原因状语从句构建复合逻辑',
      ],
      improvements: [
        '可适当引入分词伴随状语（thereby mitigating...）或否定词置首倒装句，冲击 GRA 7.5+',
      ],
      errorCorrections: [
        {
          original: firstSentence,
          corrected: `Not only does this phenomenon reshape contemporary society, but it also warrants closer scrutiny regarding its long-term ramifications.`,
          keyExpression: 'warrant closer scrutiny',
          chineseMeaning: '值得更严密的审视与考量',
          errorType: '句式多样性升级 (Syntactic Elevation)',
          explanation: '结合高级动词 warrant scrutiny（值得审视）与倒装结构提升考官第一印象。',
        },
        {
          original: secondSentence,
          corrected: `Compounded by rapid socioeconomic shifts, this issue requires pragmatic state intervention rather than superficial remedies.`,
          keyExpression: 'pragmatic state intervention',
          chineseMeaning: '务实的国家干预措施（而非表面补救）',
          errorType: '过去分词前置状语优化 (Participle Clause)',
          explanation: '利用 Compounded by... 过去分词短语作状语，有效消除 there be 句型的松散感。',
        },
      ],
    },
    improvedSampleParagraph:
      'Furthermore, addressing this multifaceted challenge necessitates a pragmatic synthesis of regulatory oversight and technological innovation. Rather than relying on superficial short-term restrictions, policymakers ought to allocate substantial resources toward sustainable infrastructure.',
    examinerSummary:
      '建议在右上角配置您的 DeepSeek API Key，即可使用 DeepSeek-V3 或 DeepSeek-R1 深度思考模型解锁针对您作文逐句精批的实时 AI 考官评分。',
    sourceMode: 'demo-engine',
  };
}
