import {
  BreakthroughStrategyItem,
  ExaminerModelEssay,
  ParagraphKeyCorrection,
  ParagraphReviewItem,
  VocabularyCard,
  WritingEvaluationReport,
  WritingTaskType,
} from '../types/ielts';

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
  if (Number.isNaN(score)) return 0;
  const clamped = Math.max(0, Math.min(9, score));
  return Math.round(clamped * 2) / 2;
}

/**
 * Converts a File or Clipboard Blob into a crisp, storage-friendly Base64 Data URL
 * and automatically crops out redundant pure-white margins around chart screenshots
 * so axis labels and numbers render as large and clear as possible.
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
        const srcW = img.width;
        const srcH = img.height;
        if (!srcW || !srcH) {
          resolve(rawDataUrl);
          return;
        }

        // Step 1: Draw raw image onto a working canvas to detect non-white content bounds
        const workCanvas = document.createElement('canvas');
        workCanvas.width = srcW;
        workCanvas.height = srcH;
        const workCtx = workCanvas.getContext('2d');
        if (!workCtx) {
          resolve(rawDataUrl);
          return;
        }
        workCtx.fillStyle = '#FFFFFF';
        workCtx.fillRect(0, 0, srcW, srcH);
        workCtx.drawImage(img, 0, 0, srcW, srcH);

        let cropX = 0;
        let cropY = 0;
        let cropW = srcW;
        let cropH = srcH;

        try {
          const imgData = workCtx.getImageData(0, 0, srcW, srcH).data;
          let minX = srcW;
          let minY = srcH;
          let maxX = 0;
          let maxY = 0;
          let foundContent = false;

          // Threshold: treat near-white pixels (R>246, G>246, B>246) as margin
          for (let y = 0; y < srcH; y += 2) {
            for (let x = 0; x < srcW; x += 2) {
              const idx = (y * srcW + x) * 4;
              const r = imgData[idx];
              const g = imgData[idx + 1];
              const b = imgData[idx + 2];
              const a = imgData[idx + 3];
              if (a > 16 && (r < 246 || g < 246 || b < 246)) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                foundContent = true;
              }
            }
          }

          if (foundContent && maxX > minX + 40 && maxY > minY + 40) {
            const pad = Math.round(Math.min(srcW, srcH) * 0.022);
            cropX = Math.max(0, minX - pad);
            cropY = Math.max(0, minY - pad);
            cropW = Math.min(srcW - cropX, maxX - minX + pad * 2);
            cropH = Math.min(srcH - cropY, maxY - minY + pad * 2);
          }
        } catch {
          // Fallback to full image if getImageData fails
        }

        // Step 2: Scale cropped area down only if larger than 1600px
        const maxDim = 1600;
        let outW = cropW;
        let outH = cropH;
        if (outW > maxDim || outH > maxDim) {
          if (outW > outH) {
            outH = Math.round((outH * maxDim) / outW);
            outW = maxDim;
          } else {
            outW = Math.round((outW * maxDim) / outH);
            outH = maxDim;
          }
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) {
          resolve(rawDataUrl);
          return;
        }
        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, outW, outH);
        outCtx.drawImage(
          workCanvas,
          cropX,
          cropY,
          cropW,
          cropH,
          0,
          0,
          outW,
          outH
        );
        resolve(outCanvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 100% Real DeepSeek IELTS Writing Examiner Evaluation
 * Outputs the 4 sequential Examiner Modules:
 * 1. 雅思官方四维评分诊断 (overallBand + dimensions)
 * 2. 逐段深度批改与逻辑重构 (paragraphReviews with keyCorrections for one-click Vocabulary ingestion)
 * 3. 突破分数天花板的核心策略 (breakthroughStrategies - Top 3 actionable strategies)
 * 4. 考官级完整范文 (modelEssay - Band 8.0+ full paragraphs & highlights)
 */
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
  const cleanModel = model.trim() || 'deepseek-chat';

  if (!cleanKey) {
    throw new Error('未检测到 DeepSeek API Key，请先在右上角设置中填写您的 API Key。');
  }

  const isTask1 = taskType === 'task1';
  const minWords = isTask1 ? 150 : 250;

  const systemInstruction = `你是一位铁面无私、经验丰富的前雅思考官（Former Senior IELTS Writing Examiner）。
请严格按照雅思官方评分标准（Task 1 要求 ≥150 词，Task 2 要求 ≥250 词）进行客观、严谨的评估，克服 AI 的讨好倾向。若文章存在未写完、字数严重不足、跑题或拼写语法错误，请严格按照真实雅思考场的扣分尺度如实给出低分与一针见血的批评！

【铁律要求 —— 严禁无中生有】：
1. 你必须严格输出包含以下 **四大核心模块** 的结构化 JSON 数据：
   - **模块一：雅思官方四维评分诊断（Band Descriptors）**：包含 overallBand（0.5分进制）和 dimensions（taOrTr、cc、lr、gra 四维的 score、diagnosis、strengths、weaknesses，以及 overallSummary 总体优缺点综述）。
   - **模块二：逐段深度批改与逻辑重构（Paragraph-by-Paragraph Critique & Reconstruction）**：按考生原文的自然段切分为 paragraphReviews 数组。每一段必须包含：
     * "paragraphIndex": 段落标识（如 "Paragraph 1 · 引言改写与总起"、"Paragraph 2 · 主体段一" 等）；
     * "originalText": 100% 逐字摘录考生该段的原始英文段落；
     * "logicAndLanguageCritique": 考官对该段逻辑推进、论证漏洞、衔接断层及语言错误的深度批注诊断（中文，一针见血）；
     * "reconstructedParagraph": 考官在保留考生原本意图的基础上，示范如何用 Band 7.5+ 的严谨逻辑与学术衔接重写该段（纯正英文）；
     * "keyCorrections": 从该段中提取 1~3 个核心词汇/短语纠错与高分升级项，供考生点击「+ 入库」直接存入背单词本。每项必须包含：
       - "originalError": 100% 摘自考生该段原文的错误拼写或低分口语词（如 "catogerise"、"more and more"）；
       - "upgradedWord": 升级后的 1 个地道雅思高分学术单词或词组（不要用斜杠堆砌多个，以便直接作为背单词词头）；
       - "phonetic": 升级词的真实英式国际音标（IPA，如 "/ˈkætəɡəraɪz/"；若为多词短语无单字音标则必须填 "" 空字符串，严禁填写 "/academic/" 等假音标！）；
       - "pos": 准确词性缩写（严格使用 "n." / "v." / "adj." / "adv." / "phrase"，严禁使用 "acad." 或 "expr."！）；
       - "meaning": 简明精准的中文释义（12字以内）；
       - "synonyms": 2~3 个地道的高分雅思同义替换词数组（严禁把考生的错误原词 originalError 放进 synonyms！）；
       - "example": 包含该升级词的地道雅思学术完整英文例句（基于考生该句改写）。
   - **模块三：突破分数天花板的核心策略（Top 3 Actionable Strategies）**：针对考生本文最致命的提分瓶颈，给出 3 条具体、可落地的突破策略 breakthroughStrategies（每条含 title 核心策略标题 与 actionableAdvice 结合原文正反对比的具体落地建议）。
   - **模块四：考官级完整范文（Examiner's Band 8.0+ Model Essay）**：针对本题题目提供一篇结构严谨、用词考究的 Band 8.0+ 考官级完整范文 modelEssay（包含 bandScore 如 "Band 8.0"、paragraphs 完整分段英文正文数组、highlights 3~5个范文高分逻辑骨架或词伙亮点解析）。

请严格返回符合以下结构的纯 JSON 对象（不要输出任何额外解释）：
{
  "overallBand": 6.0,
  "dimensions": {
    "taOrTr": {
      "score": 6.0,
      "diagnosis": "针对考生 ${isTask1 ? 'TA (Task Achievement 任务完成度，含 Overview 概述与关键数据特征涵盖)' : 'TR (Task Response 任务回应度，含审题扣题与论证深度)'} 的深度中文诊断（明确结合考生实际字数 ${wordCount} 词点评）",
      "strengths": ["基于原文的真实亮点（若无明显亮点可填 []）"],
      "weaknesses": ["一针见血的失分点1", "失分点2"]
    },
    "cc": {
      "score": 6.0,
      "diagnosis": "针对 CC (Coherence & Cohesion 逻辑连贯与衔接手段) 的深度中文诊断",
      "strengths": [],
      "weaknesses": ["失分点"]
    },
    "lr": {
      "score": 6.0,
      "diagnosis": "针对 LR (Lexical Resource 词汇丰富度、学术搭配与拼写准确度) 的深度中文诊断",
      "strengths": [],
      "weaknesses": ["失分点"]
    },
    "gra": {
      "score": 6.0,
      "diagnosis": "针对 GRA (Grammatical Range & Accuracy 句式多样性与语法准确度) 的深度中文诊断",
      "strengths": [],
      "weaknesses": ["失分点"]
    },
    "overallSummary": "考官对考生作文整体优缺点、致命硬伤与核心诊断的总结陈词（中文）"
  },
  "paragraphReviews": [
    {
      "paragraphIndex": "Paragraph 1 · 引言改写与总起",
      "originalText": "考生第一段完整原文",
      "logicAndLanguageCritique": "考官对该段逻辑推进与语言错误的深度批注诊断（中文）",
      "reconstructedParagraph": "Band 7.5+ 考官逻辑重构后的英文段落",
      "keyCorrections": [
        {
          "originalError": "100%摘自该段原文的错误或低分表达",
          "upgradedWord": "地道高分替换词或词组",
          "phonetic": "/.../（多词短语填 \"\"）",
          "pos": "n. | v. | adj. | adv. | phrase",
          "meaning": "简明精准中文释义",
          "synonyms": ["地道雅思同义词1", "地道雅思同义词2"],
          "example": "包含该升级词的完整正确雅思学术英文例句"
        }
      ]
    }
  ],
  "breakthroughStrategies": [
    {
      "title": "核心策略一标题（如：用名词化短语替代松散的口语化从句）",
      "actionableAdvice": "结合考生原文句子，给出具体的正反对比与可落地的提分操作指南"
    },
    {
      "title": "核心策略二标题",
      "actionableAdvice": "具体可落地的提分建议"
    },
    {
      "title": "核心策略三标题",
      "actionableAdvice": "具体可落地的提分建议"
    }
  ],
  "modelEssay": {
    "bandScore": "Band 8.0",
    "paragraphs": [
      "考官范文第一段完整英文...",
      "考官范文第二段完整英文...",
      "考官范文第三段完整英文...",
      "考官范文第四段完整英文..."
    ],
    "highlights": [
      "【高分词伙 / 逻辑骨架 1】：具体解析说明",
      "【高分词伙 / 逻辑骨架 2】：具体解析说明",
      "【高分词伙 / 逻辑骨架 3】：具体解析说明"
    ]
  }
}`;

  const userContent = `【任务类型】：IELTS Academic Writing ${
    isTask1 ? 'Task 1 (官方要求 ≥150 words)' : 'Task 2 (官方要求 ≥250 words)'
  }
【题目文本 (Prompt)】：
${prompt}

【前端统计的考生作文准确字数】：${wordCount} words（最低要求：${minWords} words）

【考生作文正文 (Candidate Essay)】：
${essay}`;

  const requestBody: Record<string, unknown> = {
    model: cleanModel,
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

  if (cleanModel !== 'deepseek-reasoner') {
    requestBody.temperature = 0.2;
  }

  let response: Response;
  try {
    response = await fetch(cleanEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkErr) {
    const detail =
      networkErr instanceof Error ? networkErr.message : '网络连接异常';
    throw new Error(`无法连接到 DeepSeek API (${detail})，请检查网络或 Endpoint 设置。`);
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail =
        errJson?.error?.message || errJson?.message || errorDetail;
    } catch {
      // ignore json parse error
    }
    throw new Error(`DeepSeek API 请求失败 (${errorDetail})`);
  }

  const data = await response.json();
  const messageObj = data?.choices?.[0]?.message;
  const rawText: string = messageObj?.content || '';
  const reasoningContent: string | undefined =
    typeof messageObj?.reasoning_content === 'string'
      ? messageObj.reasoning_content.trim()
      : undefined;

  if (!rawText) {
    throw new Error('DeepSeek API 返回内容为空，请重试。');
  }

  const cleanedJson = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(cleanedJson);
  } catch {
    throw new Error('DeepSeek 返回的数据格式解析失败，请重新点击交卷批改。');
  }

  // Parse Module 1: dimensions (with fallback to legacy fields if model outputs them)
  const rawDim = parsed?.dimensions || {};
  const rawTaOrTr = rawDim?.taOrTr || parsed?.trTa || {};
  const rawCc = rawDim?.cc || parsed?.cc || {};
  const rawLr = rawDim?.lr || parsed?.lr || {};
  const rawGra = rawDim?.gra || parsed?.gra || {};

  const trBand = roundToHalfBand(
    Number(rawTaOrTr?.score ?? rawTaOrTr?.band ?? 5.5)
  );
  const ccBand = roundToHalfBand(
    Number(rawCc?.score ?? rawCc?.band ?? 5.5)
  );
  const lrBand = roundToHalfBand(
    Number(rawLr?.score ?? rawLr?.band ?? 5.5)
  );
  const graBand = roundToHalfBand(
    Number(rawGra?.score ?? rawGra?.band ?? 5.5)
  );
  const calculatedOverall = roundToHalfBand(
    parsed?.overallBand !== undefined
      ? Number(parsed.overallBand)
      : (trBand + ccBand + lrBand + graBand) / 4
  );

  const normalizeStrArray = (arr: any): string[] =>
    Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];

  const cleanCorrectionItem = (raw: any): ParagraphKeyCorrection | null => {
    const upgradedWord = String(
      raw?.upgradedWord || raw?.upgraded || raw?.keyExpression || ''
    ).trim();
    if (!upgradedWord) return null;
    const originalError = String(
      raw?.originalError || raw?.original || ''
    ).trim();
    const isPhrase = upgradedWord.includes(' ');
    const rawPhonetic = String(raw?.phonetic || '').trim();
    const phonetic =
      /academic|phrase|collocation|expr/i.test(rawPhonetic) || isPhrase
        ? ''
        : rawPhonetic;
    const rawPos = String(raw?.pos || '').trim();
    const pos =
      !rawPos || /^(acad\.|expr\.)$/i.test(rawPos)
        ? isPhrase
          ? 'phrase'
          : 'n.'
        : rawPos;
    const meaning = String(
      raw?.meaning || raw?.chineseMeaning || '高分学术表达'
    ).trim();
    const synonyms = normalizeStrArray(raw?.synonyms).filter(
      (s) => s.toLowerCase() !== originalError.toLowerCase()
    );
    const example = String(
      raw?.example || raw?.upgradedSentence || raw?.corrected || ''
    ).trim();

    return {
      originalError,
      upgradedWord,
      phonetic,
      pos,
      meaning,
      synonyms,
      example,
    };
  };

  // Parse Module 2: paragraphReviews
  const paragraphReviews: ParagraphReviewItem[] = Array.isArray(
    parsed?.paragraphReviews
  )
    ? parsed.paragraphReviews
        .map((p: any, idx: number): ParagraphReviewItem => {
          const keyCorrections = Array.isArray(p?.keyCorrections)
            ? p.keyCorrections
                .map(cleanCorrectionItem)
                .filter(
                  (c: ParagraphKeyCorrection | null): c is ParagraphKeyCorrection =>
                    c !== null
                )
            : [];
          return {
            paragraphIndex: String(
              p?.paragraphIndex || `Paragraph ${idx + 1}`
            ).trim(),
            originalText: String(p?.originalText || '').trim(),
            logicAndLanguageCritique: String(
              p?.logicAndLanguageCritique || ''
            ).trim(),
            reconstructedParagraph: String(
              p?.reconstructedParagraph || ''
            ).trim(),
            keyCorrections,
          };
        })
        .filter(
          (p: ParagraphReviewItem) =>
            Boolean(p.originalText) ||
            Boolean(p.logicAndLanguageCritique) ||
            Boolean(p.reconstructedParagraph)
        )
    : [];

  // Aggregate all keyCorrections into vocabularyUpgrades + legacy lr.paraphrasingUpgrades
  const allKeyCorrections: ParagraphKeyCorrection[] = paragraphReviews.flatMap(
    (p) => p.keyCorrections
  );

  // Parse Module 3: breakthroughStrategies
  const breakthroughStrategies: BreakthroughStrategyItem[] = Array.isArray(
    parsed?.breakthroughStrategies
  )
    ? parsed.breakthroughStrategies
        .map((s: any) => ({
          title: String(s?.title || '').trim(),
          actionableAdvice: String(s?.actionableAdvice || '').trim(),
        }))
        .filter(
          (s: BreakthroughStrategyItem) =>
            Boolean(s.title) || Boolean(s.actionableAdvice)
        )
    : [];

  // Parse Module 4: modelEssay
  const rawModelEssay = parsed?.modelEssay || {};
  const modelParagraphs = normalizeStrArray(rawModelEssay?.paragraphs);
  const modelEssay: ExaminerModelEssay = {
    bandScore: String(rawModelEssay?.bandScore || 'Band 8.0').trim(),
    paragraphs:
      modelParagraphs.length > 0
        ? modelParagraphs
        : parsed?.improvedSampleParagraph
        ? [String(parsed.improvedSampleParagraph).trim()]
        : [],
    highlights: normalizeStrArray(rawModelEssay?.highlights),
  };

  const overallSummary = String(
    rawDim?.overallSummary || parsed?.examinerSummary || ''
  ).trim();

  const taDiagnosis = String(
    rawTaOrTr?.diagnosis || rawTaOrTr?.summary || ''
  ).trim();
  const ccDiagnosis = String(rawCc?.diagnosis || rawCc?.summary || '').trim();
  const lrDiagnosis = String(rawLr?.diagnosis || rawLr?.summary || '').trim();
  const graDiagnosis = String(
    rawGra?.diagnosis || rawGra?.summary || ''
  ).trim();

  return {
    id: `report-${Date.now()}`,
    createdAt: new Date().toISOString(),
    taskType,
    prompt,
    essay,
    wordCount,
    overallBand: calculatedOverall,
    dimensions: {
      taOrTr: {
        score: trBand,
        diagnosis: taDiagnosis,
        strengths: normalizeStrArray(rawTaOrTr?.strengths),
        weaknesses: normalizeStrArray(
          rawTaOrTr?.weaknesses ?? rawTaOrTr?.improvements
        ),
      },
      cc: {
        score: ccBand,
        diagnosis: ccDiagnosis,
        strengths: normalizeStrArray(rawCc?.strengths),
        weaknesses: normalizeStrArray(rawCc?.weaknesses ?? rawCc?.improvements),
      },
      lr: {
        score: lrBand,
        diagnosis: lrDiagnosis,
        strengths: normalizeStrArray(rawLr?.strengths),
        weaknesses: normalizeStrArray(rawLr?.weaknesses ?? rawLr?.improvements),
      },
      gra: {
        score: graBand,
        diagnosis: graDiagnosis,
        strengths: normalizeStrArray(rawGra?.strengths),
        weaknesses: normalizeStrArray(
          rawGra?.weaknesses ?? rawGra?.improvements
        ),
      },
      overallSummary,
    },
    paragraphReviews,
    breakthroughStrategies,
    modelEssay,
    vocabularyUpgrades: allKeyCorrections,
    // Populate legacy fields so all backward-compatible helpers continue working seamlessly
    trTa: {
      band: trBand,
      summary: taDiagnosis,
      strengths: normalizeStrArray(rawTaOrTr?.strengths),
      improvements: normalizeStrArray(
        rawTaOrTr?.weaknesses ?? rawTaOrTr?.improvements
      ),
    },
    cc: {
      band: ccBand,
      summary: ccDiagnosis,
      strengths: normalizeStrArray(rawCc?.strengths),
      improvements: normalizeStrArray(rawCc?.weaknesses ?? rawCc?.improvements),
    },
    lr: {
      band: lrBand,
      summary: lrDiagnosis,
      strengths: normalizeStrArray(rawLr?.strengths),
      improvements: normalizeStrArray(rawLr?.weaknesses ?? rawLr?.improvements),
      paraphrasingUpgrades: allKeyCorrections.map((c) => ({
        original: c.originalError,
        originalError: c.originalError,
        upgraded: c.upgradedWord,
        phonetic: c.phonetic,
        pos: c.pos,
        meaning: c.meaning,
        chineseMeaning: c.meaning,
        synonyms: c.synonyms,
        upgradedSentence: c.example,
        contextExplanation: '',
      })),
    },
    gra: {
      band: graBand,
      summary: graDiagnosis,
      strengths: normalizeStrArray(rawGra?.strengths),
      improvements: normalizeStrArray(
        rawGra?.weaknesses ?? rawGra?.improvements
      ),
      errorCorrections: [],
    },
    improvedSampleParagraph:
      modelEssay.paragraphs.join('\n\n') ||
      paragraphReviews[0]?.reconstructedParagraph ||
      '',
    examinerSummary: overallSummary,
    reasoningSummary: reasoningContent,
    sourceMode: 'deepseek',
  };
}

export interface GenerateVocabularyWithAIParams {
  rawInput: string;
  targetCategory?: 'writing' | 'task1' | 'task2';
  apiKey: string;
  endpoint?: string;
  model?: string;
}

/**
 * Uses DeepSeek API to automatically generate structured IELTS vocabulary cards
 * (with genuine IPA phonetics, accurate POS, concise IELTS Chinese meaning, and authentic IELTS example sentences)
 * from one or more user-submitted English words or phrases.
 */
export async function generateVocabularyCardsWithAI({
  rawInput,
  targetCategory = 'writing',
  apiKey,
  endpoint = DEFAULT_DEEPSEEK_ENDPOINT,
  model = 'deepseek-chat',
}: GenerateVocabularyWithAIParams): Promise<
  Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>[]
> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('请先点击右上角齿轮图标 ⚙️ 配置有效的 DeepSeek API Key。');
  }

  const words = rawInput
    .split(/[,，;\n\r]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 15);

  if (words.length === 0) {
    throw new Error('请输入至少一个英文单词或词组。');
  }

  const targetEndpoint = endpoint.trim() || DEFAULT_DEEPSEEK_ENDPOINT;
  const targetModel = model.trim() || 'deepseek-chat';

  const systemPrompt = `你是一位严谨的雅思（IELTS）学术词汇专家与词典编纂者。
用户将提供一组英文单词或短语，请你为每个单词/短语生成标准的雅思背诵卡片数据，并严格只输出合法的 JSON 对象（不要包含任何 Markdown 代码块标记）。

【严格要求】
1. "word": 规范化后的英文单词或短语（修正明显拼写错误，保持原词核心形态）。
2. "phonetic": 必须是真实的英式国际音标（IPA，例如 "/kənˈsɪdərəbl/"）。如果是多词短语，若无单字音标请填 ""（空字符串），严禁编造 "/academic/"、"/phrase/" 等假音标！
3. "partOfSpeech": 准确的词性缩写，仅限 "n."、"v."、"adj."、"adv."、"phrase"、"prep."、"conj."，严禁出现 "acad." 或 "expr."。
4. "chineseMeaning": 简明、地道的雅思核心中文释义（控制在 12 个汉字以内，不要带多余前缀）。
5. "englishDefinition": 简明的英文学术释义。
6. "paraphrasing": 2~3 个高分雅思同义替换词（字符串数组）。
7. "exampleSentence": 一句地道的雅思学术写作（Task 1 或 Task 2）真题风格英文例句，必须包含该单词或短语。
8. "exampleTranslation": 对应的精准中文翻译。

请严格返回如下 JSON 格式：
{
  "cards": [
    {
      "word": "string",
      "phonetic": "/.../",
      "partOfSpeech": "n. | v. | adj. | adv. | phrase",
      "chineseMeaning": "简明中文释义",
      "englishDefinition": "Concise English definition",
      "paraphrasing": ["synonym1", "synonym2"],
      "exampleSentence": "Authentic IELTS academic example sentence containing the word.",
      "exampleTranslation": "例句中文翻译"
    }
  ]
}`;

  const requestBody: Record<string, unknown> = {
    model: targetModel,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请为以下英文单词/词组生成雅思词汇卡片 JSON：\n${words.join('\n')}`,
      },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  let response: Response;
  try {
    response = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(
      `网络请求失败，无法连接到 DeepSeek 接口 (${
        err instanceof Error ? err.message : 'Network Error'
      })`
    );
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail =
        errJson?.error?.message || errJson?.message || errorDetail;
    } catch {
      // ignore
    }
    throw new Error(`DeepSeek 添词请求失败 (${errorDetail})`);
  }

  const data = await response.json();
  const rawText: string = data?.choices?.[0]?.message?.content || '';
  if (!rawText) {
    throw new Error('DeepSeek 返回内容为空，请重试。');
  }

  const cleanedJson = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(cleanedJson);
  } catch {
    throw new Error('DeepSeek 返回的词汇 JSON 解析失败，请重试。');
  }

  const rawCards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  if (rawCards.length === 0) {
    throw new Error('未能生成有效的词汇卡片，请检查输入的英文单词。');
  }

  return rawCards
    .map((item: any) => {
      const word = String(item?.word || '').trim();
      if (!word) return null;
      const isPhrase = word.includes(' ');
      const rawPhonetic = String(item?.phonetic || '').trim();
      const phonetic =
        /academic|phrase|collocation|expr/i.test(rawPhonetic) || isPhrase
          ? ''
          : rawPhonetic;
      const rawPos = String(item?.partOfSpeech || '').trim();
      const partOfSpeech =
        !rawPos || /^(acad\.|expr\.)$/i.test(rawPos)
          ? isPhrase
            ? 'phrase'
            : 'n.'
          : rawPos;

      return {
        word,
        phonetic,
        partOfSpeech,
        chineseMeaning: String(item?.chineseMeaning || '核心词汇').trim(),
        englishDefinition: String(
          item?.englishDefinition || 'High-frequency IELTS academic expression.'
        ).trim(),
        topicTag:
          targetCategory === 'task1'
            ? 'Task 1 核心词'
            : targetCategory === 'task2'
            ? 'Task 2 学术词'
            : 'Academic Writing',
        paraphrasing: Array.isArray(item?.paraphrasing)
          ? item.paraphrasing.map((s: any) => String(s).trim()).filter(Boolean)
          : [],
        exampleSentence: String(
          item?.exampleSentence ||
            `This concept plays a vital role in modern society (${word}).`
        ).trim(),
        exampleTranslation: String(item?.exampleTranslation || '').trim(),
        isCustom: true,
        fromWriting: targetCategory === 'writing',
        vocabCategory: targetCategory,
      } as Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>;
    })
    .filter(
      (
        c: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'> | null
      ): c is Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'> => c !== null
    );
}
