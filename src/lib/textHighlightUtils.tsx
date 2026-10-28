import React from 'react';
import {
  HighlightMarkerColor,
  TextHighlightItem,
  VocabularyCard,
} from '../types/ielts';
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  deriveConciseMeaning,
  extractAndParseJson,
} from './geminiEvaluator';

export const HIGHLIGHT_MARKER_SWATCHES: Array<{
  color: HighlightMarkerColor;
  label: string;
  dotColor: string;
  markClass: string;
}> = [
  {
    color: 'yellow',
    label: '暖珀黄高亮',
    dotColor: '#E6C37A',
    markClass:
      'bg-[#F5E6C4]/80 text-[#2C2A29] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
  },
  {
    color: 'orange',
    label: '博朗浅橙高亮',
    dotColor: '#EA5B25',
    markClass:
      'bg-[#FADCD0]/75 text-[#9E3008] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
  },
  {
    color: 'green',
    label: '鼠尾草绿高亮',
    dotColor: '#7FA682',
    markClass:
      'bg-[#DCE8DC]/80 text-[#254228] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
  },
];

export const MARKER_CLASS_MAP: Record<HighlightMarkerColor, string> = {
  yellow:
    'bg-[#F5E6C4]/80 text-[#2C2A29] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
  orange:
    'bg-[#FADCD0]/75 text-[#9E3008] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
  green:
    'bg-[#DCE8DC]/80 text-[#254228] px-1 rounded-[2px] cursor-pointer transition-all hover:brightness-95',
};

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats a note highlight marker token:
 * - yellow: `==text==`
 * - orange: `==o:text==`
 * - green:  `==g:text==`
 */
export function formatNoteHighlightToken(
  text: string,
  color: HighlightMarkerColor
): string {
  const clean = text
    .replace(/^==(?:[og]:)?/i, '')
    .replace(/==$/, '')
    .trim();
  if (!clean) return text;
  if (color === 'orange') return `==o:${clean}==`;
  if (color === 'green') return `==g:${clean}==`;
  return `==${clean}==`;
}

/**
 * Applies or updates a highlight marker (`==...==`, `==o:...==`, `==g:...==`) inside a Note's markdown content.
 */
export function applyNoteHighlightToContent(
  content: string,
  selectedText: string,
  color: HighlightMarkerColor
): string {
  const cleanTarget = selectedText
    .replace(/^==(?:[og]:)?/i, '')
    .replace(/==$/, '')
    .trim();
  if (!cleanTarget || cleanTarget.length < 2) return content;

  const newToken = formatNoteHighlightToken(cleanTarget, color);
  const escaped = escapeRegExp(cleanTarget);

  // 1. If already wrapped in ==...==, ==o:...==, or ==g:...==, update its color in place
  const wrappedRegex = new RegExp(`==(?:[og]:)?${escaped}==`, 'g');
  if (wrappedRegex.test(content)) {
    return content.replace(wrappedRegex, newToken);
  }

  // 2. Otherwise wrap the first exact occurrence in content
  const directIdx = content.indexOf(cleanTarget);
  if (directIdx !== -1) {
    return (
      content.slice(0, directIdx) +
      newToken +
      content.slice(directIdx + cleanTarget.length)
    );
  }

  // 3. Fallback: if content has `**` bold markers inside the selected text, match across optional `**`
  return content;
}

/**
 * Removes a highlight marker (`==...==`, `==o:...==`, `==g:...==`) from a Note's markdown content.
 */
export function removeNoteHighlightFromContent(
  content: string,
  targetText: string
): string {
  const cleanTarget = targetText
    .replace(/^==(?:[og]:)?/i, '')
    .replace(/==$/, '')
    .trim();
  if (!cleanTarget) return content;
  const escaped = escapeRegExp(cleanTarget);
  const wrappedRegex = new RegExp(`==(?:[og]:)?(${escaped})==`, 'g');
  return content.replace(wrappedRegex, '$1');
}

/**
 * Upserts a highlight item `{ text, color }` into a `TextHighlightItem[]` array.
 */
export function upsertHighlightInList(
  list: TextHighlightItem[] | undefined,
  text: string,
  color: HighlightMarkerColor
): TextHighlightItem[] {
  const clean = text.trim();
  if (!clean || clean.length < 2) return list || [];
  const current = Array.isArray(list) ? [...list] : [];
  const existingIdx = current.findIndex(
    (item) => item.text.trim().toLowerCase() === clean.toLowerCase()
  );
  if (existingIdx !== -1) {
    current[existingIdx] = { text: clean, color };
    return current;
  }
  return [...current, { text: clean, color }];
}

/**
 * Removes a highlight item matching `text` from a `TextHighlightItem[]` array.
 */
export function removeHighlightFromList(
  list: TextHighlightItem[] | undefined,
  text: string
): TextHighlightItem[] {
  const clean = text.trim().toLowerCase();
  if (!clean || !Array.isArray(list)) return list || [];
  return list.filter((item) => item.text.trim().toLowerCase() !== clean);
}

/**
 * Renders plain or `**bold**`-annotated text with persistent user marker highlights (`TextHighlightItem[]`).
 */
export function renderTextWithHighlights(
  rawText: string,
  highlights?: TextHighlightItem[],
  options?: {
    parseMarkdownBoldOrange?: boolean;
  }
): React.ReactNode {
  if (!rawText) return null;

  // First, if parseMarkdownBoldOrange is enabled, split by `**...**` segments
  if (options?.parseMarkdownBoldOrange) {
    const boldParts = rawText.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const inner = part.slice(2, -2);
        return (
          <span key={`b-${idx}`} className="font-medium text-[#EA5B25]">
            {renderPlainTextWithHighlights(inner, highlights, `b-${idx}`)}
          </span>
        );
      }
      return (
        <React.Fragment key={`p-${idx}`}>
          {renderPlainTextWithHighlights(part, highlights, `p-${idx}`)}
        </React.Fragment>
      );
    });
  }

  return renderPlainTextWithHighlights(rawText, highlights, 'root');
}

function renderPlainTextWithHighlights(
  text: string,
  highlights?: TextHighlightItem[],
  keyPrefix = 'hl'
): React.ReactNode {
  if (!text) return null;
  const validHighlights = (highlights || [])
    .filter((h) => h && h.text && h.text.trim().length >= 2)
    .sort((a, b) => b.text.length - a.text.length);

  if (validHighlights.length === 0) {
    return text;
  }

  const pattern = validHighlights
    .map((h) => escapeRegExp(h.text.trim()))
    .join('|');
  if (!pattern) return text;

  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (!part) return null;
    const matchedItem = validHighlights.find(
      (h) => h.text.trim().toLowerCase() === part.toLowerCase()
    );
    if (matchedItem) {
      const color = matchedItem.color || 'yellow';
      return (
        <mark
          key={`${keyPrefix}-m-${idx}`}
          data-highlight-text={matchedItem.text}
          data-highlight-color={color}
          title="点击可修改或擦除高亮"
          className={MARKER_CLASS_MAP[color]}
        >
          {part}
        </mark>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${idx}`}>{part}</React.Fragment>;
  });
}

/**
 * Calls `deepseek-v4-flash` to complete dictionary details for a selected English word/phrase
 * when the user clicks `[ + 存词 ]` in the Selection Popover.
 */
export async function completeSelectedVocabWithDeepSeek(params: {
  selectedText: string;
  contextSentence?: string;
  apiKey: string;
  endpoint?: string;
}): Promise<Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>> {
  const cleanWord = params.selectedText
    .replace(/^==(?:[og]:)?/i, '')
    .replace(/==$/, '')
    .replace(/\*\*/g, '')
    .trim();

  const cleanKey = params.apiKey.trim();
  const cleanEndpoint =
    (params.endpoint || '').trim() || DEFAULT_DEEPSEEK_ENDPOINT;

  if (!cleanKey) {
    throw new Error('请先点击右上角齿轮图标配置 DeepSeek API Key。');
  }

  const systemPrompt = `你是一位严谨的《雅思学术双解词典》主编。用户从雅思笔记或范文中划选了一个英文生词或词伙，请为其生成完整的双层词卡 JSON：
1. "word": 规范化后的词头或短语（如 "${cleanWord}"）；
2. "phonetic": 若为单个单词提供纯正英式 IPA 音标（如 "/dɪˈvɜːdʒ/"），若为多词短语必须填 ""；
3. "pos": 准确词性（如 "v. / n."、"adj."、"phrase"）；
4. "meaning": **精简版释义（默认展示）**：极其精炼的 2~3 个核心意思（严格控制在 15~18 字以内，无冗余括号）；
5. "fullMeaning": **全义项版释义（展开展示）**：按词性详列日常核心义项、雅思学术义项、熟词僻义与核心固定搭配，不同词性用 " | " 隔开；
6. "synonyms": 2~3 个地道雅思同义替换词数组；
7. "exampleSentence": 一句地道雅思学术英文例句；
8. "exampleTranslation": 对应的中文翻译。

只返回如下纯 JSON 对象：
{
  "word": "${cleanWord}",
  "phonetic": "",
  "pos": "phrase",
  "meaning": "...",
  "fullMeaning": "...",
  "synonyms": ["...", "..."],
  "exampleSentence": "...",
  "exampleTranslation": "..."
}`;

  const response = await fetch(cleanEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cleanKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `划选词/短语：${cleanWord}${
            params.contextSentence ? `\n上下文参考：${params.contextSentence}` : ''
          }`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`存词请求失败 (${response.status}): ${errText.slice(0, 80)}`);
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  const parsed = extractAndParseJson(content);

  const headword = String(parsed.word || cleanWord).trim();
  const isPhrase = headword.includes(' ');
  const phonetic = isPhrase ? '' : String(parsed.phonetic || '').trim();
  const pos = String(parsed.pos || (isPhrase ? 'phrase' : 'n.')).trim();
  const rawMeaning = String(parsed.meaning || '高分学术表达').trim();
  const concise = deriveConciseMeaning(rawMeaning);
  const fullMeaning = String(parsed.fullMeaning || concise).trim();
  const synonyms = Array.isArray(parsed.synonyms)
    ? parsed.synonyms.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];
  const exampleSentence = String(
    parsed.exampleSentence || params.contextSentence || headword
  ).trim();
  const exampleTranslation = String(parsed.exampleTranslation || '').trim();

  return {
    word: headword,
    phonetic,
    partOfSpeech: pos,
    meaning: concise,
    chineseMeaning: concise,
    fullMeaning,
    englishDefinition: headword,
    paraphrasing: synonyms,
    synonyms,
    exampleSentence,
    exampleTranslation,
    topicTag: '划词积累',
    isCustom: true,
    fromWriting: true,
    vocabCategory: 'writing',
  };
}
