import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  DeepSeekConfig,
  HighlightMarkerColor,
  NoteCategory,
  NoteItem,
  NoteSubType,
  VocabularyCard,
} from '../types/ielts';
import {
  expandNoteWithDeepSeek,
  formatCompactNoteDate,
  formatNoteClassificationLabel,
  getCleanNoteExcerpt,
  getNoteSubTypeSortOrder,
  normalizeNoteCategory,
  normalizeNoteSubType,
  NOTE_CLASSIFICATION_OPTIONS,
  NOTE_FILTER_TABS,
} from '../lib/defaultNotes';
import {
  applyNoteHighlightToContent,
  escapeRegExp,
  formatNoteHighlightToken,
  MARKER_CLASS_MAP,
  removeNoteHighlightFromContent,
} from '../lib/textHighlightUtils';
import { SelectionHighlightPopover } from './SelectionHighlightPopover';

interface NotesModuleProps {
  notes: NoteItem[];
  onUpdateNotes: React.Dispatch<React.SetStateAction<NoteItem[]>>;
  aiConfig: DeepSeekConfig;
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
  onExcerptToNotes?: (payload: {
    sourceKey: string;
    markdownBlock: string;
  }) => void;
  onOpenApiKeyModal?: () => void;
}

/**
 * Renders inline text in Reading Mode:
 * - Converts `==text==` (yellow), `==o:text==` (orange), `==g:text==` (green) into warm paper marker `<mark>` spans
 * - Converts `**text**` into highlighted bold text (hiding the `**` symbols completely)
 * - Converts `` `code` `` into clean inline text (hiding backticks)
 * - Strips any stray unmatched `**` or `==` so raw Markdown symbols are never exposed
 */
function renderFormattedInline(rawText: string): React.ReactNode {
  if (!rawText) return null;
  const cleanedBackticks = rawText.replace(/`([^`]+)`/g, '$1');
  const tokenRegex = /==(o:|g:)?([\s\S]+?)==|\*\*([^*]+?)\*\*/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(cleanedBackticks)) !== null) {
    if (match.index > lastIndex) {
      const plainSeg = cleanedBackticks
        .slice(lastIndex, match.index)
        .replace(/\*\*/g, '');
      nodes.push(plainSeg);
    }

    if (match[2] !== undefined) {
      const prefix = (match[1] || '').toLowerCase();
      const color: HighlightMarkerColor =
        prefix === 'o:' ? 'orange' : prefix === 'g:' ? 'green' : 'yellow';
      const innerText = match[2].replace(/\*\*/g, '').trim();
      if (innerText) {
        nodes.push(
          <mark
            key={`mk-${match.index}`}
            data-highlight-text={innerText}
            data-highlight-color={color}
            title="点击可切换颜色或擦除高亮"
            className={MARKER_CLASS_MAP[color]}
          >
            {innerText}
          </mark>
        );
      }
    } else if (match[3] !== undefined) {
      const highlighted = match[3].trim();
      if (highlighted) {
        const hasLatin = /[A-Za-z]/.test(highlighted);
        nodes.push(
          <span
            key={`hl-${match.index}`}
            className={
              hasLatin
                ? 'font-semibold text-[#EA5B25]'
                : 'font-semibold text-[#2C2A29]'
            }
          >
            {highlighted}
          </span>
        );
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleanedBackticks.length) {
    const tailSeg = cleanedBackticks.slice(lastIndex).replace(/\*\*/g, '');
    nodes.push(tailSeg);
  }

  return nodes.length > 0 ? nodes : cleanedBackticks.replace(/\*\*/g, '');
}

/**
 * Determines whether a line is predominantly an English example sentence
 * so we can render it in Newsreader Serif automatically in Reading Mode.
 */
function isPredominantlyEnglishSentence(line: string): boolean {
  const clean = line.replace(/\*\*/g, '').trim();
  if (!clean) return false;
  const cjkMatches = clean.match(/[\u4e00-\u9fff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const latinMatches = clean.match(/[A-Za-z]/g);
  const latinCount = latinMatches ? latinMatches.length : 0;
  return latinCount > 16 && cjkCount === 0;
}

/**
 * Lightweight Reading Mode Formatter:
 * - Renders `## Heading` / `### Heading` as bold subheadings (hiding `#` symbols)
 * - Renders `> Quote / Formula` as a left 2px Braun Orange vertical rule block (hiding `>` symbols)
 * - Renders `**text**` as Braun Orange / charcoal bold text (hiding `**` symbols)
 */
function renderNoteReadingBody(content: string): React.ReactNode {
  if (!content.trim()) {
    return (
      <p className="font-sans text-sm italic text-[#ACA79C]">
        双击此处或点击右上角「编辑」开始撰写笔记，也可输入简短指令后点击「AI 提炼扩写」生成结构化内容...
      </p>
    );
  }

  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      idx += 1;
      continue;
    }

    // Horizontal divider `---`
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr-${idx}`}
          className="my-5 border-0 border-t border-dashed border-[#DFDBD0]"
        />
      );
      idx += 1;
      continue;
    }

    // Blockquote / Formula block (`> ...` or `STRUCTURE:` / `FORMULA`)
    if (
      trimmed.startsWith('>') ||
      /^(?:FORMULA|STRUCTURE)\b/i.test(trimmed)
    ) {
      const quoteLines: string[] = [];
      while (
        idx < lines.length &&
        (lines[idx].trim().startsWith('>') ||
          /^(?:FORMULA|STRUCTURE)\b/i.test(lines[idx].trim()))
      ) {
        const strippedQuote = lines[idx]
          .trim()
          .replace(/^>+\s*/, '')
          .replace(/^#+\s*/, '');
        if (strippedQuote) {
          quoteLines.push(strippedQuote);
        }
        idx += 1;
      }

      blocks.push(
        <blockquote
          key={`quote-${idx}`}
          className="my-4 border-l-2 border-[#EA5B25] bg-[#F5F2EA]/75 py-2.5 pl-4 pr-3"
        >
          {quoteLines.map((qLine, qIdx) => {
            const isPureEn = isPredominantlyEnglishSentence(qLine);
            return (
              <p
                key={qIdx}
                className={
                  isPureEn
                    ? 'mt-1 font-serif text-[16px] leading-relaxed text-[#2C2A29] first:mt-0'
                    : 'mt-1 font-sans text-[13.5px] leading-relaxed text-[#2C2A29] first:mt-0'
                }
              >
                {renderFormattedInline(qLine)}
              </p>
            );
          })}
        </blockquote>
      );
      continue;
    }

    // Section Heading (`# ...`, `## ...`, `### ...`) — hides all `#` symbols
    if (/^#{1,6}\s*/.test(trimmed)) {
      const headingText = trimmed.replace(/^#{1,6}\s*/, '').trim();
      blocks.push(
        <h3
          key={`h-${idx}`}
          className="mt-6 mb-2.5 border-b border-[#EBE6DF] pb-1.5 font-sans text-[15px] font-semibold tracking-tight text-[#2C2A29] first:mt-0"
        >
          {renderFormattedInline(headingText)}
        </h3>
      );
      idx += 1;
      continue;
    }

    // Bullet list item (`- ...` or `• ...` or `* ...`)
    if (/^(?:[-•]|\*(?!\*))\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^(?:[-•]|\*(?!\*))\s+/, '').trim();
      const labelMatch = itemText.match(
        /^((?:5\.5分原句|8\.0分升格|您的原句|原句|Band\s*8\.0\s*重写|英文例句)[：:]\s*)(.+)$/i
      );

      blocks.push(
        <div
          key={`li-${idx}`}
          className="my-1.5 flex items-baseline gap-2.5 pl-1"
        >
          <span className="h-1 w-1 shrink-0 translate-y-[-2px] rounded-full bg-[#EA5B25]" />
          {labelMatch ? (
            <p className="font-sans text-[14px] leading-[1.75] text-[#2C2A29]">
              <span className="font-sans text-xs text-[#8C867E]">
                {labelMatch[1]}
              </span>
              <span className="font-serif text-[16.5px] leading-[1.8] text-[#2C2A29]">
                {renderFormattedInline(labelMatch[2])}
              </span>
            </p>
          ) : (
            <p
              className={
                isPredominantlyEnglishSentence(itemText)
                  ? 'font-serif text-[16.5px] leading-[1.8] text-[#2C2A29]'
                  : 'font-sans text-[14px] leading-[1.75] text-[#2C2A29]'
              }
            >
              {renderFormattedInline(itemText)}
            </p>
          )}
        </div>
      );
      idx += 1;
      continue;
    }

    // Numbered item (`1. ...`)
    if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push(
        <p
          key={`num-${idx}`}
          className="mt-3.5 mb-1 font-sans text-[14px] leading-[1.8] text-[#2C2A29]"
        >
          {renderFormattedInline(trimmed)}
        </p>
      );
      idx += 1;
      continue;
    }

    // Regular paragraph: auto-detect English example vs Chinese commentary
    const isEnglish = isPredominantlyEnglishSentence(trimmed);
    blocks.push(
      <p
        key={`p-${idx}`}
        className={
          isEnglish
            ? 'my-2.5 font-serif text-[17px] leading-[1.85] text-[#2C2A29]'
            : 'my-2 font-sans text-[14px] leading-[1.8] text-[#2C2A29]'
        }
      >
        {renderFormattedInline(trimmed)}
      </p>
    );
    idx += 1;
  }

  return <div className="space-y-1">{blocks}</div>;
}

export const NotesModule: React.FC<NotesModuleProps> = ({
  notes,
  onUpdateNotes,
  aiConfig,
  onIngestVocab,
  onExcerptToNotes,
  onOpenApiKeyModal,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'ALL' | NoteCategory>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string>(() => {
    return notes[0]?.id || '';
  });

  // Reading vs Editing mode ('read' is default as specified)
  const [editorMode, setEditorMode] = useState<'read' | 'edit'>('read');

  // Custom Classification Dropdown state in Right Toolbar (Zero native <select>!)
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);

  // AI Refinement / Expansion state
  const [isAiExpanding, setIsAiExpanding] = useState(false);
  const [aiErrorMsg, setAiErrorMsg] = useState<string | null>(null);

  const categoryDropdownRef = useRef<HTMLDivElement | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const noteBodyContainerRef = useRef<HTMLDivElement | null>(null);

  // Close custom classification popover when clicking outside
  useEffect(() => {
    if (!isCategoryMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(e.target as Node)
      ) {
        setIsCategoryMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [isCategoryMenuOpen]);

  // Sorted & Filtered Notes:
  // - Pinned first
  // - When filtering by 'Task 1' or 'Task 2', automatically group/sort by subType order (Line graph -> Bar chart -> ...)
  // - Then by updatedAt descending
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...notes]
      .filter((n) => {
        const normCat = normalizeNoteCategory(n.category);
        if (selectedFilter !== 'ALL' && normCat !== selectedFilter) {
          return false;
        }
        if (!q) return true;
        const label = formatNoteClassificationLabel(n).toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          label.includes(q)
        );
      })
      .sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
          return a.isPinned ? -1 : 1;
        }
        if (selectedFilter === 'Task 1' || selectedFilter === 'Task 2') {
          const rankDiff =
            getNoteSubTypeSortOrder(a) - getNoteSubTypeSortOrder(b);
          if (rankDiff !== 0) return rankDiff;
        }
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [notes, selectedFilter, searchQuery]);

  // Strictly resolve activeNote from filteredNotes so top category filter & right pane remain 100% consistent!
  const activeNote = useMemo(() => {
    const foundInFiltered = filteredNotes.find((n) => n.id === activeNoteId);
    if (foundInFiltered) return foundInFiltered;
    return filteredNotes[0] || null;
  }, [filteredNotes, activeNoteId]);

  useEffect(() => {
    if (activeNote && activeNote.id !== activeNoteId) {
      setActiveNoteId(activeNote.id);
    }
  }, [activeNote, activeNoteId]);

  // Auto-resize textarea in Edit mode
  useEffect(() => {
    if (editorMode !== 'edit') return;
    const el = editorTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(420, el.scrollHeight)}px`;
  }, [editorMode, activeNote?.content, activeNote?.id]);

  // Create a new note [ + 新建笔记 ] — inherits the active top category filter if selected
  const handleCreateNewNote = () => {
    setAiErrorMsg(null);
    const defaultCategory: NoteCategory =
      selectedFilter === 'ALL' ? 'Task 1' : selectedFilter;
    const defaultSubType: NoteSubType = normalizeNoteSubType(defaultCategory);
    const nowIso = new Date().toISOString();
    const newNote: NoteItem = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: '未命名笔记',
      category: defaultCategory,
      subType: defaultSubType,
      content: '',
      isPinned: false,
      updatedAt: nowIso,
    };

    onUpdateNotes((prev) => [newNote, ...prev]);
    setActiveNoteId(newNote.id);
    setEditorMode('edit');
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 40);
  };

  // Update active note fields in real time (saved immediately to localStorage 'ielts_studio_notes')
  const handleUpdateActiveNote = (
    patch: Partial<
      Pick<NoteItem, 'title' | 'category' | 'subType' | 'content' | 'isPinned'>
    >
  ) => {
    if (!activeNote) return;
    const nowIso = new Date().toISOString();
    onUpdateNotes((prev) =>
      prev.map((item) =>
        item.id === activeNote.id
          ? {
              ...item,
              ...patch,
              updatedAt: nowIso,
            }
          : item
      )
    );

    // Fix category filter sync: if user changes the note's category in the right dropdown while a conflicting top filter is active,
    // automatically switch the top filter bar to the new category so left and right views stay 100% consistent!
    if (
      patch.category &&
      selectedFilter !== 'ALL' &&
      selectedFilter !== patch.category
    ) {
      setSelectedFilter(patch.category);
    }
  };

  // Toggle Pin on any note item in the left directory
  const handleTogglePinNote = (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNotes((prev) =>
      prev.map((item) =>
        item.id === noteId ? { ...item, isPinned: !item.isPinned } : item
      )
    );
  };

  // Delete a note item in the left directory
  const handleDeleteNote = (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNotes((prev) => {
      const next = prev.filter((item) => item.id !== noteId);
      if (activeNoteId === noteId) {
        setActiveNoteId(next[0]?.id || '');
      }
      return next;
    });
  };

  // AI Refinement & Expansion [ AI 提炼扩写 ] ('deepseek-v4-pro')
  const handleAiExpandNote = async () => {
    if (!activeNote) return;
    setAiErrorMsg(null);

    if (!aiConfig.apiKey.trim()) {
      setAiErrorMsg('请先点击右上角齿轮图标配置 DeepSeek API Key。');
      onOpenApiKeyModal?.();
      return;
    }

    setIsAiExpanding(true);
    try {
      const classificationLabel = formatNoteClassificationLabel(activeNote);
      const refined = await expandNoteWithDeepSeek({
        title: activeNote.title,
        classificationLabel,
        content: activeNote.content,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
      });

      handleUpdateActiveNote({
        title: refined.title,
        content: refined.content,
      });
      setEditorMode('read');
    } catch (err) {
      setAiErrorMsg(
        err instanceof Error ? err.message : 'AI 提炼扩写失败，请稍后重试。'
      );
    } finally {
      setIsAiExpanding(false);
    }
  };

  const charCount = activeNote ? activeNote.content.trim().length : 0;
  const activeClassificationLabel = activeNote
    ? formatNoteClassificationLabel(activeNote)
    : 'Task 1 · Line graph';

  // Selection Highlight Handlers for Notes (Both Reading Mode & Editing Mode)
  const isNoteTextAlreadyHighlighted = (text: string): boolean => {
    if (!activeNote) return false;
    const clean = text.trim();
    if (!clean) return false;
    const escaped = escapeRegExp(clean);
    const regex = new RegExp(`==(?:[og]:)?${escaped}==`);
    return regex.test(activeNote.content);
  };

  const handleApplyNoteHighlight = (
    text: string,
    color: HighlightMarkerColor,
    textareaSelection?: {
      textarea: HTMLTextAreaElement;
      start: number;
      end: number;
    }
  ) => {
    if (!activeNote) return;
    if (textareaSelection && editorMode === 'edit') {
      const { start, end } = textareaSelection;
      const before = activeNote.content.slice(0, start);
      const selectedRaw = activeNote.content.slice(start, end);
      const after = activeNote.content.slice(end);
      const token = formatNoteHighlightToken(selectedRaw || text, color);
      handleUpdateActiveNote({
        content: `${before}${token}${after}`,
      });
      return;
    }

    const updatedContent = applyNoteHighlightToContent(
      activeNote.content,
      text,
      color
    );
    handleUpdateActiveNote({ content: updatedContent });
  };

  const handleEraseNoteHighlight = (
    text: string,
    textareaSelection?: {
      textarea: HTMLTextAreaElement;
      start: number;
      end: number;
    }
  ) => {
    if (!activeNote) return;
    if (textareaSelection && editorMode === 'edit') {
      const { start, end } = textareaSelection;
      const before = activeNote.content.slice(0, start);
      const selectedRaw = activeNote.content.slice(start, end);
      const after = activeNote.content.slice(end);
      const unwrapped = selectedRaw
        .replace(/^==(?:[og]:)?/i, '')
        .replace(/==$/, '');
      handleUpdateActiveNote({
        content: `${before}${unwrapped}${after}`,
      });
      return;
    }

    const updatedContent = removeNoteHighlightFromContent(
      activeNote.content,
      text
    );
    handleUpdateActiveNote({ content: updatedContent });
  };

  return (
    <div className="mx-auto w-[92vw] max-w-[1280px] pb-14 pt-1">
      <section className="skeuo-paper overflow-hidden rounded-2xl">
        {/* Smartisan Vintage Double Crimson Header Rule */}
        <div className="pt-4">
          <div className="h-[2px] w-full bg-[#C97A63]/35" />
          <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
        </div>

        {/* ===================================================================
            1. 纸面顶部筛选栏（仅固定 4 个大类：全部 | Task 1 | Task 2 | 摘录复盘）
           =================================================================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-6 py-4 font-sans sm:px-8">
          {/* Left 4 Top-Level Category Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {NOTE_FILTER_TABS.map((tab) => {
              const isSelected = selectedFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSelectedFilter(tab.key)}
                  className={`rounded-lg px-3.5 py-1.5 text-xs transition-all ${
                    isSelected
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#8C867E] hover:text-[#262523]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Right Symmetrical Search Filter + [ + 新建笔记 ] */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="skeuo-input-slot flex h-8 w-56 items-center gap-2 rounded-lg px-3 sm:w-64">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9E988E]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索笔记标题或正文..."
                className="w-full bg-transparent font-sans text-xs text-[#262523] placeholder:text-[#ACA79C] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-[#ACA79C] hover:text-[#262523]"
                  aria-label="清空搜索"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCreateNewNote}
              className="skeuo-btn-orange inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 font-sans text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建笔记</span>
            </button>
          </div>
        </div>

        {/* ===================================================================
            2. 空状态 vs 双栏对开工作台（左栏目录 30% · 右栏沉浸式道林纸信纸 70%）
           =================================================================== */}
        {notes.length === 0 ? (
          <div className="flex min-h-[540px] items-center justify-center px-8 py-24 text-center">
            <p className="font-sans text-sm text-[#8C867E]">
              暂无笔记，点击右上角「+ 新建笔记」或从写作批改/小练习中一键摘录
            </p>
          </div>
        ) : (
          <div className="grid min-h-[680px] grid-cols-1 lg:grid-cols-[30%_70%]">
            {/* LEFT COLUMN (30% width): Minimalist Stationery Directory List */}
            <aside className="border-b border-[#E6E3DA] bg-[#F7F4EC]/60 lg:border-b-0 lg:border-r">
              {filteredNotes.length === 0 ? (
                <div className="px-6 py-20 text-center">
                  <p className="font-sans text-xs text-[#8C867E]">
                    暂无笔记，点击右上角「+ 新建笔记」或从写作批改/小练习中一键摘录
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#EBE6DF]">
                  {filteredNotes.map((item) => {
                    const isSelected = activeNote?.id === item.id;
                    const excerpt = getCleanNoteExcerpt(item.content);
                    const compactDate = formatCompactNoteDate(item.updatedAt);
                    const sentenceCaseLabel =
                      formatNoteClassificationLabel(item);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setAiErrorMsg(null);
                          setActiveNoteId(item.id);
                          setEditorMode('read');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setAiErrorMsg(null);
                            setActiveNoteId(item.id);
                            setEditorMode('read');
                          }
                        }}
                        className={`group relative cursor-pointer px-5 py-4 transition-colors ${
                          isSelected
                            ? 'border-l-[3px] border-l-[#EA5B25] bg-[#EFECE6]'
                            : 'border-l-[3px] border-l-transparent hover:bg-[#F3F0E7]'
                        }`}
                      >
                        {/* Row 1: Left Sentence-case SubType Label (font-sans text-[12px] text-[#8C867E]) | Right Date / Hover Actions */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {item.isPinned && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#EA5B25]"
                                title="已置顶笔记"
                              />
                            )}
                            <span className="truncate font-sans text-[12px] text-[#8C867E]">
                              {sentenceCaseLabel}
                            </span>
                          </div>

                          <div className="relative flex shrink-0 items-center justify-end">
                            {/* Gentle Date MM/DD (fades out on row hover to make room for Pin/Delete) */}
                            <span className="whitespace-nowrap font-sans text-[12px] text-[#ACA79C] transition-opacity duration-150 group-hover:opacity-0 select-none">
                              {compactDate}
                            </span>

                            {/* Hover Action Triggers: [ 置顶 ] / [ 取消 ] & Delete (strictly single-line, zero vertical wrap) */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 flex shrink-0 items-center gap-1 whitespace-nowrap opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto"
                            >
                              <button
                                type="button"
                                onClick={(e) => handleTogglePinNote(item.id, e)}
                                className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-sans text-[11px] font-medium text-[#5C5852] transition-colors hover:bg-[#E5E1D7] hover:text-[#EA5B25]"
                              >
                                {item.isPinned ? '[ 取消 ]' : '[ 置顶 ]'}
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleDeleteNote(item.id, e)}
                                className="shrink-0 p-0.5 text-[#B5B0A4] transition-colors hover:text-[#EA5B25]"
                                title="删除该篇手账"
                                aria-label="删除该篇手账"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Row 2: Note Title */}
                        <h4 className="mt-1.5 truncate font-sans text-[15px] font-medium text-[#2C2A29]">
                          {item.title || '未命名笔记'}
                        </h4>

                        {/* Row 3: Single-Line Light Gray Excerpt */}
                        <p className="mt-1 truncate font-sans text-[13px] text-[#8C867E]">
                          {excerpt}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>

            {/* RIGHT COLUMN (70% width): Immersive Stationery Reading / Writing Sheet */}
            <div className="flex flex-col justify-between bg-[#FAF8F3]/75">
              {activeNote ? (
                <div>
                  {/* Right Column Top Toolbar (Single-line justified) */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EBE6DF] px-8 py-3.5">
                    {/* Left: Custom Ivory Rounded SubType Switcher (Sentence case, e.g. Task 1 · Line graph) */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div ref={categoryDropdownRef} className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setIsCategoryMenuOpen((prev) => !prev)
                          }
                          className="skeuo-btn-light inline-flex items-center gap-1.5 rounded-lg px-3 py-1 font-sans text-xs font-medium text-[#2C2A29]"
                        >
                          <span>{activeClassificationLabel}</span>
                          <ChevronDown className="h-3 w-3 text-[#8C867E]" />
                        </button>

                        {isCategoryMenuOpen && (
                          <div className="skeuo-paper absolute left-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-[#DFDBD0] p-1.5 shadow-lg">
                            {NOTE_CLASSIFICATION_OPTIONS.map((opt) => {
                              const isCurrent =
                                activeClassificationLabel === opt.displayLabel;
                              return (
                                <button
                                  key={opt.displayLabel}
                                  type="button"
                                  onClick={() => {
                                    handleUpdateActiveNote({
                                      category: opt.category,
                                      subType: opt.subType,
                                    });
                                    setIsCategoryMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left font-sans text-xs transition-colors ${
                                    isCurrent
                                      ? 'bg-[#EFECE3] font-semibold text-[#EA5B25]'
                                      : 'text-[#2C2A29] hover:bg-[#F4F1E8]'
                                  }`}
                                >
                                  <span>{opt.displayLabel}</span>
                                  {isCurrent && (
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#EA5B25]" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <span className="font-sans text-xs text-[#9E988E]">
                        已自动保存 · {charCount} 字
                      </span>
                    </div>

                    {/* Right: [ AI 提炼扩写 ] + [ 编辑 / 阅读 ] Toggle */}
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isAiExpanding}
                        onClick={handleAiExpandNote}
                        className="skeuo-btn-light inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-xs font-medium text-[#2C2A29] transition-colors hover:text-[#EA5B25] disabled:opacity-50"
                        title="调用 deepseek-v4-pro 将当前笔记或指令提炼扩写为结构化考官笔记"
                      >
                        {isAiExpanding ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#EA5B25]" />
                            <span>AI 提炼中...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-[#EA5B25]" />
                            <span>AI 提炼扩写</span>
                          </>
                        )}
                      </button>

                      <div className="skeuo-groove inline-flex items-center rounded-lg p-0.5 font-sans">
                        <button
                          type="button"
                          onClick={() => setEditorMode('read')}
                          className={`rounded-md px-3 py-1 text-xs transition-all ${
                            editorMode === 'read'
                              ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                              : 'text-[#8C867E] hover:text-[#262523]'
                          }`}
                        >
                          阅读
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorMode('edit')}
                          className={`rounded-md px-3 py-1 text-xs transition-all ${
                            editorMode === 'edit'
                              ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                              : 'text-[#8C867E] hover:text-[#262523]'
                          }`}
                        >
                          编辑
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Error Alert if AI Expand fails */}
                  {aiErrorMsg && (
                    <div className="border-b border-[#E5C5B8] bg-[#FAF0EC] px-8 py-2.5 font-sans text-xs text-[#EA5B25]">
                      {aiErrorMsg}
                    </div>
                  )}

                  {/* Main Sheet Content Area: Large Borderless Title Input + Reading/Editing Body */}
                  <div
                    ref={noteBodyContainerRef}
                    className="relative px-8 py-7 sm:px-12"
                  >
                    <SelectionHighlightPopover
                      containerRef={noteBodyContainerRef}
                      aiConfig={aiConfig}
                      sourceLabel={activeNote.title || activeClassificationLabel}
                      isTextHighlighted={isNoteTextAlreadyHighlighted}
                      onApplyHighlight={handleApplyNoteHighlight}
                      onEraseHighlight={handleEraseNoteHighlight}
                      onIngestVocab={onIngestVocab}
                      onExcerptToNotes={onExcerptToNotes}
                      onOpenApiKeyModal={onOpenApiKeyModal}
                    />

                    {/* Large Borderless Title Input */}
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={activeNote.title}
                      onChange={(e) =>
                        handleUpdateActiveNote({ title: e.target.value })
                      }
                      placeholder="输入笔记标题..."
                      className="w-full border-0 border-b border-[#EBE6DF] bg-transparent pb-3.5 font-sans text-[22px] font-semibold tracking-tight text-[#2C2A29] placeholder:text-[#C2BDB2] focus:border-[#EA5B25] focus:outline-none transition-colors"
                    />

                    {/* Body: Reading Mode vs Ruled-Line Textarea Editing Mode */}
                    {editorMode === 'read' ? (
                      <div
                        onDoubleClick={() => setEditorMode('edit')}
                        title="双击正文可直接进入编辑模式"
                        className="mt-6 min-h-[460px] cursor-text pb-8"
                      >
                        {renderNoteReadingBody(activeNote.content)}
                      </div>
                    ) : (
                      <div className="mt-4">
                        <textarea
                          ref={editorTextareaRef}
                          value={activeNote.content}
                          onChange={(e) =>
                            handleUpdateActiveNote({ content: e.target.value })
                          }
                          placeholder="在此输入笔记正文，或写下简短指令（如：帮我总结 Task 1 地图题表示拆除、扩建、原址替换的高分句型）后点击右上角「AI 提炼扩写」..."
                          className="lined-textarea min-h-[460px] w-full resize-none border-0 bg-transparent font-sans text-[14.5px] text-[#2C2A29] placeholder:text-[#B8B2A6] focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[540px] flex-col items-center justify-center px-8 py-24 text-center">
                  <p className="font-sans text-sm text-[#8C867E]">
                    暂无笔记，点击右上角「+ 新建笔记」或从写作批改/小练习中一键摘录
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
