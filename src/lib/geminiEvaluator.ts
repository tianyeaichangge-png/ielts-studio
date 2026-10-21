import {
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
 * Zero mock fallbacks, zero hardcoded scores or fake vocabulary lists.
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
请严格按照雅思官方评分标准（Task 1 要求 ≥150 词，Task 2 要求 ≥250 词）进行客观、铁面无私的评估，克服 AI 的讨好倾向。请自主判断考生的文章是否完整、是否覆盖核心要求（TA/TR）、逻辑是否连贯（CC）、词汇与语法是否准确（LR/GRA）。若文章存在未写完、字数严重不足、跑题或拼写语法错误，请严格按照真实雅思考场的扣分尺度如实给出低分与一针见血的批评！

【铁律要求 —— 严禁无中生有】：
1. 你给出的所有分数（overallBand 以及四项小分）完全由你根据考生实际表现自主裁定（步长为 0.5 分，如 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0 等）。如果字数严重不足（例如仅几十词）、文章未写完或严重跑题，TA/TR 及总分必须如实大幅扣分（例如给出 3.0 - 4.5 分），绝不允许给安慰分或虚假好评！
2. 评语中指出的所有优缺点，以及 LR 模块（paraphrasingUpgrades）和 GRA 模块（errorCorrections）列出的“原文错误/低分表达 -> 高分升级替换”，必须 **100% 逐字摘自考生实际提交的这篇作文原文**（例如精准揪出原文中的拼写错误、语法错误、未写完的残缺句或低幼表达），绝不允许编造原文中不存在的词汇或句子！
3. 在 paraphrasingUpgrades 中：
   - "original": 必须逐字摘自考生原文中的真实词汇或短语（包含拼写错误或低分口语表达）；
   - "originalError": 考生原文中写错的原词或不当原词（如 "catogerise"）；
   - "upgraded": 推荐替换的 1 个核心雅思高分单词或词组（不要用斜杠堆砌多个，以便考生一键入库背诵与默写）；
   - "phonetic": 该推荐单词的真实国际音标（如 "/ˈkætəɡəriz/"；若为多词短语无单字音标则返回 "" 空字符串，严禁填写 "/academic/" 等假音标！）；
   - "pos": 准确词性缩写（严格使用 "n." / "v." / "adj." / "adv." / "phrase"，严禁使用 "acad." 或 "expr."！）；
   - "meaning": 该推荐词的精准中文释义（同 chineseMeaning）；
   - "chineseMeaning": 该推荐词的精准中文释义；
   - "synonyms": 额外提供 2~3 个与该推荐词同义的地道正确雅思学术词汇数组（如 ["classifications", "types"]，严禁把考生的错误原词 originalError 放进 synonyms！）；
   - "upgradedSentence": 将考生包含该词的原句用该高分推荐词改写后的完整正确英文例句；
   - "contextExplanation": 结合考生原句一针见血地说明原词存在的问题（如拼写错误、搭配不当、语体过口语）及升级理由。
4. 在 errorCorrections 中：
   - "original": 必须逐字摘自考生原文中含有语法错误、拼写错误、句子残缺或中式表达的真实原句/分句；
   - "originalError": 该句中考生拼写错误或误用的具体原词（如有，如 "catogerise"）；
   - "corrected": 修正并升级后的地道英文句子；
   - "keyExpression": 该修正句中最值得收录背诵的 1 个核心高分单词或短语；
   - "phonetic": keyExpression 的真实国际音标（若为单字则给真实音标如 "/ˈkætəɡəriz/"，若为多词短语则返回 "" 空字符串，严禁假音标！）；
   - "pos": keyExpression 的准确词性缩写（"n." / "v." / "adj." / "adv." / "phrase"）；
   - "meaning": 该核心表达的简明中文释义（同 chineseMeaning）；
   - "chineseMeaning": 该核心表达的简明中文释义；
   - "synonyms": 额外提供 2~3 个与 keyExpression 同义的地道正确雅思词汇数组（严禁把考生的错误原词放进 synonyms！）；
   - "errorType": 具体错误类型（如：拼写错误 / 句子未写完残缺 / 主谓不一致 / 冠词与介词误用 / 句式单薄）；
   - "explanation": 针对该原句的具体纠错解析。

请严格返回符合以下结构的纯 JSON 对象（不要输出任何 Markdown 代码块包裹以外的额外解释）：
{
  "overallBand": number,
  "trTa": {
    "band": number,
    "summary": "对考生 ${isTask1 ? 'TA (Task Achievement 任务完成度)' : 'TR (Task Response 任务回应度)'} 的一针见血中文评语（明确结合考生实际字数 ${wordCount} 词、是否写完、是否扣题进行真实点评）",
    "strengths": ["基于原文的真实亮点（若无明显亮点可写空数组 []）"],
    "improvements": ["一针见血的改进建议1", "一针见血的改进建议2"]
  },
  "cc": {
    "band": number,
    "summary": "对考生 CC (Coherence and Cohesion 逻辑连贯与衔接) 的真实中文评语",
    "strengths": [],
    "improvements": ["改进建议"]
  },
  "lr": {
    "band": number,
    "summary": "对考生 LR (Lexical Resource 词汇丰富度、拼写准确度与搭配) 的真实中文评语",
    "strengths": [],
    "improvements": ["改进建议"],
    "paraphrasingUpgrades": [
      {
        "original": "100%摘自考生原文的词或短语",
        "originalError": "考生原文误写或低分原词",
        "upgraded": "地道高分替换词/短语",
        "phonetic": "/ˈkætəɡəriz/（多词短语填 \"\"）",
        "pos": "n. / v. / adj. / adv. / phrase",
        "meaning": "精准中文释义",
        "chineseMeaning": "精准中文释义",
        "synonyms": ["地道雅思同义词1", "地道雅思同义词2"],
        "upgradedSentence": "基于考生原句改写后的完整正确英文例句",
        "contextExplanation": "为什么原词不妥及替换解析"
      }
    ]
  },
  "gra": {
    "band": number,
    "summary": "对考生 GRA (Grammatical Range and Accuracy 语法结构与准确性) 的真实中文评语",
    "strengths": [],
    "improvements": ["改进建议"],
    "errorCorrections": [
      {
        "original": "100%摘自考生原文的错误或残缺原句",
        "originalError": "原文中写错的具体单词（如有）",
        "corrected": "修正并升级后的完整英文句",
        "keyExpression": "修正句中的核心可背诵单词/短语",
        "phonetic": "单字填真实国际音标，短语填 \"\"",
        "pos": "n. / v. / adj. / adv. / phrase",
        "meaning": "该核心词/短语的中文释义",
        "chineseMeaning": "该核心词/短语的中文释义",
        "synonyms": ["地道雅思同义词1", "地道雅思同义词2"],
        "errorType": "错误类型",
        "explanation": "具体语法/拼写纠错说明"
      }
    ]
  },
  "improvedSampleParagraph": "针对考生原文内容重写或续写的一段地道雅思高分示范段落（全英文）",
  "examinerSummary": "考官总结陈词与下一步核心改进方向（中文）"
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

  const trBand = roundToHalfBand(Number(parsed?.trTa?.band));
  const ccBand = roundToHalfBand(Number(parsed?.cc?.band));
  const lrBand = roundToHalfBand(Number(parsed?.lr?.band));
  const graBand = roundToHalfBand(Number(parsed?.gra?.band));
  const calculatedOverall = roundToHalfBand(
    parsed?.overallBand !== undefined
      ? Number(parsed.overallBand)
      : (trBand + ccBand + lrBand + graBand) / 4
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
      summary: String(parsed?.trTa?.summary || ''),
      strengths: Array.isArray(parsed?.trTa?.strengths)
        ? parsed.trTa.strengths
        : [],
      improvements: Array.isArray(parsed?.trTa?.improvements)
        ? parsed.trTa.improvements
        : [],
    },
    cc: {
      band: ccBand,
      summary: String(parsed?.cc?.summary || ''),
      strengths: Array.isArray(parsed?.cc?.strengths)
        ? parsed.cc.strengths
        : [],
      improvements: Array.isArray(parsed?.cc?.improvements)
        ? parsed.cc.improvements
        : [],
    },
    lr: {
      band: lrBand,
      summary: String(parsed?.lr?.summary || ''),
      strengths: Array.isArray(parsed?.lr?.strengths)
        ? parsed.lr.strengths
        : [],
      improvements: Array.isArray(parsed?.lr?.improvements)
        ? parsed.lr.improvements
        : [],
      paraphrasingUpgrades: Array.isArray(parsed?.lr?.paraphrasingUpgrades)
        ? parsed.lr.paraphrasingUpgrades
        : [],
    },
    gra: {
      band: graBand,
      summary: String(parsed?.gra?.summary || ''),
      strengths: Array.isArray(parsed?.gra?.strengths)
        ? parsed.gra.strengths
        : [],
      improvements: Array.isArray(parsed?.gra?.improvements)
        ? parsed.gra.improvements
        : [],
      errorCorrections: Array.isArray(parsed?.gra?.errorCorrections)
        ? parsed.gra.errorCorrections
        : [],
    },
    improvedSampleParagraph: String(parsed?.improvedSampleParagraph || ''),
    examinerSummary: String(parsed?.examinerSummary || ''),
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
