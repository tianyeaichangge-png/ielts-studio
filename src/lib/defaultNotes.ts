import { NoteCategory } from '../types/ielts';
import {
  DEFAULT_DEEPSEEK_ENDPOINT,
  extractAndParseJson,
} from './geminiEvaluator';

export const NOTE_CATEGORIES: NoteCategory[] = [
  'Task 1',
  'Task 2',
  '句法词伙',
  '摘录复盘',
];

export const NOTE_FILTER_TABS: Array<{
  key: 'ALL' | NoteCategory;
  label: string;
}> = [
  { key: 'ALL', label: '全部' },
  { key: 'Task 1', label: 'Task 1' },
  { key: 'Task 2', label: 'Task 2' },
  { key: '句法词伙', label: '句法词伙' },
  { key: '摘录复盘', label: '摘录复盘' },
];

export const REVIEW_NOTEBOOK_ID = 'note-review-archive';
export const REVIEW_NOTEBOOK_TITLE = '批改与小练习复盘手账';

/**
 * Normalizes legacy note category labels into the 4 clean categories:
 * 'Task 1' | 'Task 2' | '句法词伙' | '摘录复盘'
 */
export function normalizeNoteCategory(raw?: string): NoteCategory {
  const val = (raw || '').trim();
  if (val === 'Task 1' || val === 'Task 1 技巧') return 'Task 1';
  if (val === 'Task 2' || val === 'Task 2 逻辑') return 'Task 2';
  if (val === '句法词伙' || val === '句法与词伙' || val === '核心讲义') {
    return '句法词伙';
  }
  if (val === '摘录复盘' || val === '批改复盘') return '摘录复盘';
  return 'Task 1';
}

/**
 * Strips markdown syntax from note content to generate a clean single-line preview for the directory list.
 */
export function getCleanNoteExcerpt(content: string): string {
  const plain = content
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*/g, '')
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
 * into a clean, well-organized Examiner Lecture Note.
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

  const systemPrompt = `你是一位资深雅思考官兼学术写作讲义主编。请基于用户当前笔记的【标题】、【所属分类】与【已有零散笔记或指令】，将其提炼扩写为一份条理清晰、干净整洁的雅思写作高分笔记。

【排版与内容规范（严禁彩色 Emoji 与杂乱符号）】：
1. **严禁使用任何彩色 Emoji 图标**，拒绝堆砌繁杂的特殊符号，保持纸面干净整洁。
2. 正文请使用简洁清晰的分段排版：
   - 大模块小标题以 \`## 一、 ...\` 开头（不嵌套多余符号）；
   - 核心句型公式行以 \`> \` 开头（单行或多行简洁公式）；
   - 提供 2~3 组地道 Band 8.0 英文示范句或低分升格对照，仅将英文句中最核心的 1~2 个高分词伙用 \`**词伙**\` 标记；
   - 易错避坑要点用简洁的 \`- \` 列表呈现。
3. 若原笔记标题为空或为默认占位标题，请一并提炼一个准确精炼的标题。

请严格返回如下纯 JSON 对象（不要输出任何额外解释）：
{
  "title": "提炼后的专业笔记标题",
  "content": "干净整洁的分段正文内容（换行用 \\n）"
}`;

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
        {
          role: 'user',
          content: `所属分类：${params.category}\n当前标题：${
            params.title.trim() || '未命名笔记'
          }\n当前笔记内容或扩写指令：\n${
            params.content.trim() ||
            `请围绕「${params.title.trim() || params.category}」生成一份包含核心句型公式、易错避坑与 Band 8.0 地道例句对照的精炼笔记。`
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

  const nextTitle = String(parsed.title || params.title || '雅思写作笔记').trim();
  const nextContent = String(parsed.content || '').trim();

  if (!nextContent) {
    throw new Error('AI 未返回有效的笔记内容，请重试。');
  }

  return {
    title: nextTitle,
    content: nextContent,
  };
}
