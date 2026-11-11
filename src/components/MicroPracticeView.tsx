import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import {
  DeepSeekConfig,
  HighlightMarkerColor,
  TextHighlightItem,
  VocabularyCard,
} from '../types/ielts';
import {
  BUILTIN_MICRO_QUESTIONS,
  evaluateMicroPracticeSentence,
  generateVocabMicroQuestion,
  MICRO_PRACTICE_SUBTYPES,
  MicroPracticeEvaluation,
  MicroPracticeHistoryRecord,
  MicroPracticeLexiconItem,
  MicroPracticeQuestion,
  MicroPracticeSubType,
  MicroPracticeTaskGroup,
  pickCandidateWordForMicroPractice,
} from '../lib/microPracticeData';
import {
  removeHighlightFromList,
  renderTextWithHighlights,
  upsertHighlightInList,
} from '../lib/textHighlightUtils';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { SelectionHighlightPopover } from './SelectionHighlightPopover';

interface MicroPracticeViewProps {
  aiConfig: DeepSeekConfig;
  vocabCards: VocabularyCard[];
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
  onExcerptToNotes?: (payload: {
    sourceKey: string;
    markdownBlock: string;
  }) => void;
  excerptedKeys?: Set<string>;
  onOpenApiKeyModal?: () => void;
}

type HistoryFilterType = 'ALL' | 'T1' | 'T2' | 'VOCAB';

const toolbarClass =
  'flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-4 py-4 font-sans sm:px-8';
const keyboardFocusClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#EA5B25]';

function filterButtonClass(isActive: boolean): string {
  return `min-h-8 rounded-lg border px-3 py-1.5 font-sans text-xs transition-colors ${keyboardFocusClass} ${
    isActive
      ? 'skeuo-switch-thumb font-semibold text-[#2C2A29]'
      : 'border-transparent text-[#8C867E] hover:text-[#2C2A29]'
  }`;
}

/**
 * Renders an English sentence in Newsreader serif, coloring `**highlighted**` segments
 * in pure Braun Signal Orange (#EA5B25) text without any background box.
 */
function renderHighlightedSentence(sentence: string): React.ReactNode {
  if (!sentence) return null;
  const parts = sentence.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const cleanText = part.slice(2, -2);
      return (
        <span key={index} className="font-medium text-[#EA5B25]">
          {cleanText}
        </span>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function formatHistoryTimestamp(isoOrStr: string): string {
  try {
    const d = new Date(isoOrStr);
    if (Number.isNaN(d.getTime())) return isoOrStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  } catch {
    return isoOrStr;
  }
}

function getSubTypeLabel(subType: MicroPracticeSubType): string {
  return (
    MICRO_PRACTICE_SUBTYPES.find((s) => s.key === subType)?.label || subType
  );
}

export const MicroPracticeView: React.FC<MicroPracticeViewProps> = ({
  aiConfig,
  vocabCards,
  onIngestVocab,
  onExcerptToNotes,
  excerptedKeys,
  onOpenApiKeyModal,
}) => {
  // View mode: 'practice' (main typewriter workbench) | 'history' (sentence history archive)
  const [viewMode, setViewMode] = useState<'practice' | 'history'>('practice');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterType>('ALL');
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<
    Record<string, boolean>
  >({});

  const [taskGroup, setTaskGroup] = useLocalStorage<MicroPracticeTaskGroup>(
    'ielts_micro_practice_group_v1',
    'T1'
  );
  const [activeSubType, setActiveSubType] =
    useLocalStorage<MicroPracticeSubType>(
      'ielts_micro_practice_subtype_v1',
      'dynamic'
    );
  const [isFreeRewrite, setIsFreeRewrite] = useState(false);

  // Persist AI-generated custom vocab questions per subType so users can cycle through them
  const [customQuestions, setCustomQuestions] = useLocalStorage<
    MicroPracticeQuestion[]
  >('ielts_micro_practice_custom_questions_v1', []);

  // Track current question index per subType
  const [indexBySubType, setIndexBySubType] = useLocalStorage<
    Record<MicroPracticeSubType, number>
  >('ielts_micro_practice_indices_v1', {
    dynamic: 0,
    static: 0,
    map: 0,
    process: 0,
    opinion: 0,
    discussion: 0,
    pros_cons: 0,
    report: 0,
  });

  // 1. LocalStorage Persistent Sentence History ('ielts_studio_sentence_history')
  const [sentenceHistory, setSentenceHistory] = useLocalStorage<
    MicroPracticeHistoryRecord[]
  >('ielts_studio_sentence_history', []);

  // Active editor sentence & active evaluation state in the workbench
  const [userSentence, setUserSentence] = useState('');
  const [activeEvaluation, setActiveEvaluation] =
    useState<MicroPracticeEvaluation | null>(null);
  const [activeHistoryRecordId, setActiveHistoryRecordId] = useState<
    string | null
  >(null);

  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const feedbackContainerRef = useRef<HTMLDivElement | null>(null);
  const historyContainerRef = useRef<HTMLDivElement | null>(null);

  // Sub-types belonging to the active T1 / T2 group
  const groupSubTypes = useMemo(
    () => MICRO_PRACTICE_SUBTYPES.filter((s) => s.group === taskGroup),
    [taskGroup]
  );

  // Ensure activeSubType matches taskGroup
  const currentSubTypeMeta = useMemo(() => {
    const matched = groupSubTypes.find((s) => s.key === activeSubType);
    return matched || groupSubTypes[0];
  }, [groupSubTypes, activeSubType]);

  // Questions for the current subType (3 built-in + any AI vocab questions generated for this subType)
  const subTypeQuestions = useMemo(() => {
    const builtIns = BUILTIN_MICRO_QUESTIONS.filter(
      (q) => q.subType === currentSubTypeMeta.key
    );
    const customs = customQuestions.filter(
      (q) => q.subType === currentSubTypeMeta.key
    );
    return [...builtIns, ...customs];
  }, [currentSubTypeMeta.key, customQuestions]);

  const rawIndex = indexBySubType[currentSubTypeMeta.key] || 0;
  const safeIndex =
    subTypeQuestions.length > 0 ? rawIndex % subTypeQuestions.length : 0;
  const currentQuestion = subTypeQuestions[safeIndex] || subTypeQuestions[0];

  // Find the latest history record for the current questionId (when not in free-rewrite mode)
  const latestRecordForCurrentQuestion = useMemo(() => {
    if (isFreeRewrite || !currentQuestion) return null;
    return (
      sentenceHistory.find((rec) => rec.questionId === currentQuestion.id) ||
      null
    );
  }, [isFreeRewrite, currentQuestion, sentenceHistory]);

  // 2. Auto-echo practiced state or clear input & evaluation when switching questions / modes
  const activeQuestionKey = isFreeRewrite
    ? `FREE_${currentSubTypeMeta.key}`
    : currentQuestion?.id || '';

  useEffect(() => {
    if (isFreeRewrite) {
      setUserSentence('');
      setActiveEvaluation(null);
      setActiveHistoryRecordId(null);
      return;
    }
    if (!currentQuestion) {
      setUserSentence('');
      setActiveEvaluation(null);
      setActiveHistoryRecordId(null);
      return;
    }
    const matchedRecord = sentenceHistory.find(
      (rec) => rec.questionId === currentQuestion.id
    );
    if (matchedRecord) {
      setUserSentence(matchedRecord.userSentence);
      setActiveHistoryRecordId(matchedRecord.id);
      setActiveEvaluation({
        band: matchedRecord.bandScore,
        diagnosis: matchedRecord.diagnosis,
        band7Sentence: matchedRecord.band7Sentence,
        band7Highlights: [],
        band8Sentence: matchedRecord.band8Sentence,
        structureFormula: matchedRecord.structureFormula,
        lexicon: Array.isArray(matchedRecord.lexicon)
          ? matchedRecord.lexicon
          : [],
        highlights: Array.isArray(matchedRecord.highlights)
          ? matchedRecord.highlights
          : [],
      });
    } else {
      setUserSentence('');
      setActiveEvaluation(null);
      setActiveHistoryRecordId(null);
    }
    // Only trigger when switching question or toggling free-rewrite mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuestionKey]);

  // Auto-resize typewriter textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(64, el.scrollHeight)}px`;
  }, [userSentence, activeQuestionKey, viewMode]);

  // Check if a lexicon word is already in the user's vocabulary bank
  const isWordInVocabBank = (word: string): boolean => {
    const norm = word.trim().toLowerCase();
    return vocabCards.some((c) => c.word.trim().toLowerCase() === norm);
  };

  // Filtered history list for the History Archive view
  const filteredHistory = useMemo(() => {
    switch (historyFilter) {
      case 'T1':
        return sentenceHistory.filter((r) => r.taskType === 'T1');
      case 'T2':
        return sentenceHistory.filter((r) => r.taskType === 'T2');
      case 'VOCAB':
        return sentenceHistory.filter((r) => Boolean(r.targetWord));
      default:
        return sentenceHistory;
    }
  }, [sentenceHistory, historyFilter]);

  // Switch T1 / T2 group
  const handleSelectGroup = (nextGroup: MicroPracticeTaskGroup) => {
    setErrorMsg(null);
    setTaskGroup(nextGroup);
    const firstSub = MICRO_PRACTICE_SUBTYPES.find((s) => s.group === nextGroup);
    if (firstSub) {
      setActiveSubType(firstSub.key);
    }
  };

  // Switch subType tab
  const handleSelectSubType = (subKey: MicroPracticeSubType) => {
    setErrorMsg(null);
    setIsFreeRewrite(false);
    setActiveSubType(subKey);
  };

  // Cycle to next question in current subType [ 下一题 → ]
  const handleNextQuestion = () => {
    setErrorMsg(null);
    if (isFreeRewrite) {
      setIsFreeRewrite(false);
      return;
    }
    if (subTypeQuestions.length === 0) return;
    const nextIdx = (safeIndex + 1) % subTypeQuestions.length;
    setIndexBySubType((prev) => ({
      ...prev,
      [currentSubTypeMeta.key]: nextIdx,
    }));
  };

  // Generate a new question using a word from '待攻克' or '写作积累' [ ↻ 用生词出题 ]
  const handleGenerateVocabQuestion = async () => {
    setErrorMsg(null);
    if (!aiConfig.apiKey.trim()) {
      setErrorMsg('请先点击右上角齿轮图标配置 DeepSeek API Key。');
      onOpenApiKeyModal?.();
      return;
    }

    const candidate = pickCandidateWordForMicroPractice(
      vocabCards,
      taskGroup,
      currentQuestion?.targetWord
    );
    if (!candidate) {
      setErrorMsg('当前词库暂无可用生词。');
      return;
    }

    setIsGeneratingQuestion(true);
    try {
      const newQuestion = await generateVocabMicroQuestion({
        group: taskGroup,
        subTypeMeta: currentSubTypeMeta,
        targetCard: candidate,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
      });

      const nextListForSubType = [
        ...BUILTIN_MICRO_QUESTIONS.filter(
          (q) => q.subType === currentSubTypeMeta.key
        ),
        ...customQuestions.filter((q) => q.subType === currentSubTypeMeta.key),
        newQuestion,
      ];

      setCustomQuestions((prev) => [...prev, newQuestion]);
      setIsFreeRewrite(false);
      setIndexBySubType((prev) => ({
        ...prev,
        [currentSubTypeMeta.key]: nextListForSubType.length - 1,
      }));
      setUserSentence('');
      setActiveEvaluation(null);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 60);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : '生词出题失败，请稍后重试。'
      );
    } finally {
      setIsGeneratingQuestion(false);
    }
  };

  // Evaluate current sentence with deepseek-v4-pro [ 批改这一句 ] & persist to 'ielts_studio_sentence_history'
  const handleEvaluateSentence = async () => {
    setErrorMsg(null);
    const trimmedUserSentence = userSentence.trim();
    if (!trimmedUserSentence) {
      setErrorMsg('请先在横线上输入您的英文改写句。');
      textareaRef.current?.focus();
      return;
    }
    if (!aiConfig.apiKey.trim()) {
      setErrorMsg('请先点击右上角齿轮图标配置 DeepSeek API Key。');
      onOpenApiKeyModal?.();
      return;
    }

    setIsEvaluating(true);
    try {
      const result = await evaluateMicroPracticeSentence({
        group: taskGroup,
        subTypeMeta: currentSubTypeMeta,
        isFreeRewrite,
        question: currentQuestion,
        userSentence: trimmedUserSentence,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
      });

      const newRecordId = `mp-hist-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      setActiveEvaluation({ ...result, highlights: [] });
      setActiveHistoryRecordId(newRecordId);

      // Persist to localStorage ('ielts_studio_sentence_history')
      const newHistoryRecord: MicroPracticeHistoryRecord = {
        id: newRecordId,
        timestamp: new Date().toISOString(),
        taskType: isFreeRewrite ? 'FREE' : taskGroup,
        category: currentSubTypeMeta.key,
        questionId: isFreeRewrite
          ? `free-${Date.now()}`
          : currentQuestion?.id || `q-${Date.now()}`,
        chineseMeaning: isFreeRewrite
          ? ''
          : currentQuestion?.chineseMeaning || '',
        rawSentence: isFreeRewrite
          ? ''
          : currentQuestion?.rawLowBandSentence || '',
        targetWord: isFreeRewrite ? undefined : currentQuestion?.targetWord,
        userSentence: trimmedUserSentence,
        diagnosis: result.diagnosis,
        bandScore: result.band,
        band7Sentence: result.band7Sentence,
        band8Sentence: result.band8Sentence,
        structureFormula: result.structureFormula,
        lexicon: result.lexicon,
        highlights: [],
      };

      setSentenceHistory((prev) => [newHistoryRecord, ...prev]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : '批改请求失败，请检查网络或 API Key。'
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  // Load any historical record back into the main practice workbench for review or rewrite
  const handleLoadHistoryRecord = (record: MicroPracticeHistoryRecord) => {
    setErrorMsg(null);

    if (record.taskType === 'FREE') {
      const subMeta = MICRO_PRACTICE_SUBTYPES.find(
        (s) => s.key === record.category
      );
      if (subMeta) {
        setTaskGroup(subMeta.group);
        setActiveSubType(subMeta.key);
      }
      setIsFreeRewrite(true);
      setViewMode('practice');
      setTimeout(() => {
        setUserSentence(record.userSentence);
        setActiveHistoryRecordId(record.id);
        setActiveEvaluation({
          band: record.bandScore,
          diagnosis: record.diagnosis,
          band7Sentence: record.band7Sentence,
          band7Highlights: [],
          band8Sentence: record.band8Sentence,
          structureFormula: record.structureFormula,
          lexicon: Array.isArray(record.lexicon) ? record.lexicon : [],
          highlights: Array.isArray(record.highlights)
            ? record.highlights
            : [],
        });
      }, 0);
      return;
    }

    const subMeta =
      MICRO_PRACTICE_SUBTYPES.find((s) => s.key === record.category) ||
      MICRO_PRACTICE_SUBTYPES[0];
    setTaskGroup(subMeta.group);
    setActiveSubType(subMeta.key);
    setIsFreeRewrite(false);

    const builtInsForSub = BUILTIN_MICRO_QUESTIONS.filter(
      (q) => q.subType === subMeta.key
    );
    const customsForSub = customQuestions.filter(
      (q) => q.subType === subMeta.key
    );
    const combined = [...builtInsForSub, ...customsForSub];
    let targetIdx = combined.findIndex((q) => q.id === record.questionId);

    // If it was an AI vocab question not yet in customQuestions, restore it
    if (targetIdx === -1 && record.chineseMeaning && record.rawSentence) {
      const restoredQuestion: MicroPracticeQuestion = {
        id: record.questionId,
        group: subMeta.group,
        subType: subMeta.key,
        chineseMeaning: record.chineseMeaning,
        rawLowBandSentence: record.rawSentence,
        targetWord: record.targetWord,
      };
      setCustomQuestions((prev) => [...prev, restoredQuestion]);
      targetIdx = combined.length;
    }

    if (targetIdx !== -1) {
      setIndexBySubType((prev) => ({
        ...prev,
        [subMeta.key]: targetIdx,
      }));
    }

    setViewMode('practice');
    setTimeout(() => {
      setUserSentence(record.userSentence);
      setActiveHistoryRecordId(record.id);
      setActiveEvaluation({
        band: record.bandScore,
        diagnosis: record.diagnosis,
        band7Sentence: record.band7Sentence,
        band7Highlights: [],
        band8Sentence: record.band8Sentence,
        structureFormula: record.structureFormula,
        lexicon: Array.isArray(record.lexicon) ? record.lexicon : [],
        highlights: Array.isArray(record.highlights) ? record.highlights : [],
      });
    }, 0);
  };

  // Delete a single history record
  const handleDeleteHistoryRecord = (
    recordId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setSentenceHistory((prev) => prev.filter((r) => r.id !== recordId));
  };

  // Persistent Highlight Handlers for Micro-Practice Evaluation & History
  const updateMicroPracticeHighlights = (nextHighlights: TextHighlightItem[]) => {
    setActiveEvaluation((prev) =>
      prev ? { ...prev, highlights: nextHighlights } : null
    );
    setSentenceHistory((prev) =>
      prev.map((rec) => {
        if (activeHistoryRecordId && rec.id === activeHistoryRecordId) {
          return { ...rec, highlights: nextHighlights };
        }
        if (
          !activeHistoryRecordId &&
          !isFreeRewrite &&
          currentQuestion &&
          rec.questionId === currentQuestion.id
        ) {
          return { ...rec, highlights: nextHighlights };
        }
        return rec;
      })
    );
  };

  const handleApplyMicroHighlight = (
    text: string,
    color: HighlightMarkerColor
  ) => {
    if (viewMode === 'history') {
      const lower = text.trim().toLowerCase();
      setSentenceHistory((prev) =>
        prev.map((rec) => {
          const inRec =
            rec.band8Sentence.toLowerCase().includes(lower) ||
            rec.userSentence.toLowerCase().includes(lower) ||
            rec.chineseMeaning.toLowerCase().includes(lower);
          if (!inRec) return rec;
          return {
            ...rec,
            highlights: upsertHighlightInList(rec.highlights, text, color),
          };
        })
      );
      return;
    }
    if (!activeEvaluation) return;
    const next = upsertHighlightInList(
      activeEvaluation.highlights,
      text,
      color
    );
    updateMicroPracticeHighlights(next);
  };

  const handleEraseMicroHighlight = (text: string) => {
    if (viewMode === 'history') {
      setSentenceHistory((prev) =>
        prev.map((rec) => ({
          ...rec,
          highlights: removeHighlightFromList(rec.highlights, text),
        }))
      );
      return;
    }
    if (!activeEvaluation) return;
    const next = removeHighlightFromList(activeEvaluation.highlights, text);
    updateMicroPracticeHighlights(next);
  };

  const isMicroTextHighlighted = (text: string): boolean => {
    const clean = text.trim().toLowerCase();
    if (viewMode === 'history') {
      return sentenceHistory.some((rec) =>
        rec.highlights?.some((h) => h.text.trim().toLowerCase() === clean)
      );
    }
    return Boolean(
      activeEvaluation?.highlights?.some(
        (h) => h.text.trim().toLowerCase() === clean
      )
    );
  };

  // Silent 1-click vocabulary ingestion into '写作积累' word-box (with both meaning & fullMeaning)
  const handleIngestLexicon = (item: MicroPracticeLexiconItem) => {
    if (isWordInVocabBank(item.word)) return;
    onIngestVocab({
      word: item.word,
      phonetic: item.phonetic,
      partOfSpeech: item.pos,
      meaning: item.meaning,
      chineseMeaning: item.meaning,
      fullMeaning: item.fullMeaning,
      englishDefinition: item.word,
      paraphrasing: item.synonyms,
      synonyms: item.synonyms,
      exampleSentence:
        item.example ||
        activeEvaluation?.band8Sentence.replace(/\*\*/g, '') ||
        userSentence.trim(),
      exampleTranslation: isFreeRewrite
        ? ''
        : currentQuestion?.chineseMeaning || '',
      topicTag: `${taskGroup} · ${currentSubTypeMeta.label}`,
      isCustom: true,
      fromWriting: true,
      vocabCategory: 'writing',
    });
  };

  const formattedIdx = String(safeIndex + 1).padStart(2, '0');
  const formattedTotal = String(subTypeQuestions.length).padStart(2, '0');
  const taskGroupTitle = taskGroup === 'T1' ? 'Task 1' : 'Task 2';
  const nameplateText = isFreeRewrite
    ? `${taskGroupTitle} · ${currentSubTypeMeta.enCode} · 自由改写`
    : `${taskGroupTitle} · ${currentSubTypeMeta.enCode} · ${formattedIdx} / ${formattedTotal}`;

  const tactileMicroBtnClass =
    `skeuo-btn-light inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 font-sans text-xs font-medium ${keyboardFocusClass}`;
  const tactileMicroBtnDisabledClass =
    'inline-flex min-h-8 cursor-default items-center rounded-lg border border-[#DCD6CC] bg-[#EFECE6] px-3 py-1.5 font-sans text-xs text-[#8C867E]';

  const toggleHistoryItemExpand = (recordId: string) => {
    setExpandedHistoryIds((prev) => ({
      ...prev,
      [recordId]: !prev[recordId],
    }));
  };

  return (
    <div className="w-full">
      <section className="skeuo-paper overflow-hidden rounded-2xl">
        {/* Smartisan Vintage Double Crimson Header Rule */}
        <div className="pt-4">
          <div className="h-[2px] w-full bg-[#C97A63]/35" />
          <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
        </div>

        {viewMode === 'history' ? (
          /* =================================================================
              HISTORY ARCHIVE VIEW: 极简「小练习历史记录」视图
             ================================================================= */
          <div>
            <div className={toolbarClass}>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setViewMode('practice')}
                  className={tactileMicroBtnClass}
                >
                  ← 返回练习
                </button>
                <h2 className="text-sm font-semibold text-[#2C2A29]">小练习历史记录</h2>
              </div>

              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="历史记录分类">
                {(
                  [
                    { key: 'ALL', label: '全部' },
                    { key: 'T1', label: 'Task 1' },
                    { key: 'T2', label: 'Task 2' },
                    { key: 'VOCAB', label: '生词造句' },
                  ] as const
                ).map((tab) => {
                  const isActive = historyFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setHistoryFilter(tab.key)}
                      aria-pressed={isActive}
                      className={filterButtonClass(isActive)}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* History List Body (Separated by thin stationery horizontal lines, zero nested card boxes) */}
            <div
              ref={historyContainerRef}
              className="relative px-4 py-4 sm:px-8"
            >
              <SelectionHighlightPopover
                containerRef={historyContainerRef}
                aiConfig={aiConfig}
                sourceLabel="小练习 · 历史记录"
                isTextHighlighted={isMicroTextHighlighted}
                onApplyHighlight={handleApplyMicroHighlight}
                onEraseHighlight={handleEraseMicroHighlight}
                onIngestVocab={onIngestVocab}
                onExcerptToNotes={onExcerptToNotes}
                onOpenApiKeyModal={onOpenApiKeyModal}
              />

              {filteredHistory.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="font-sans text-sm font-medium text-[#262523]">
                    暂无小练习批改记录
                  </p>
                  <p className="mt-1.5 font-sans text-xs text-[#8C867E]">
                    完成单句升格练习并点击「批改这一句」后，所有历史记录将自动归档于此。
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#EBE6DF]">
                  {filteredHistory.map((rec) => {
                    const catLabel =
                      rec.taskType === 'FREE'
                        ? '自由改写'
                        : `${rec.taskType === 'T1' ? 'Task 1' : 'Task 2'} · ${getSubTypeLabel(rec.category)}`;
                    const isExpanded = Boolean(expandedHistoryIds[rec.id]);

                    return (
                      <div
                        key={rec.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          const sel = window.getSelection();
                          if (sel && sel.toString().trim().length > 0) {
                            return;
                          }
                          toggleHistoryItemExpand(rec.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleHistoryItemExpand(rec.id);
                          }
                        }}
                        className="group -mx-3 cursor-pointer rounded-lg px-3 py-5 transition-colors hover:bg-[#F4F1E8]/60"
                      >
                        {/* Top Row: Left ● Band x.x + Task Nameplate + Target | Right Timestamp + 重新练习 → + Hover Delete */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="flex flex-wrap items-center gap-3 font-sans text-xs"
                          >
                            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#262523]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                              <span>Band {rec.bandScore.toFixed(1)}</span>
                            </span>

                            <span className="text-[#8C867E]">{catLabel}</span>

                            {rec.targetWord && (
                              <span className="font-mono font-medium text-[#EA5B25]">
                                Target: {rec.targetWord}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              style={{
                                fontVariantNumeric: 'lining-nums tabular-nums',
                              }}
                              className="font-mono text-[11px] text-[#ACA79C]"
                            >
                              {formatHistoryTimestamp(rec.timestamp)}
                            </span>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLoadHistoryRecord(rec);
                              }}
                              className={tactileMicroBtnClass}
                            >
                              重新练习 →
                            </button>

                            <button
                              type="button"
                              onClick={(e) =>
                                handleDeleteHistoryRecord(rec.id, e)
                              }
                              className="p-1 text-[#B5B0A4] opacity-0 transition-opacity hover:text-[#EA5B25] group-hover:opacity-100"
                              title="删除该条记录"
                              aria-label="删除该条记录"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Middle Row: Muted gray Chinese meaning + User's sentence */}
                        <div className="mt-2 space-y-1">
                          {rec.chineseMeaning && (
                            <p className="font-sans text-xs text-[#8C867E]">
                              {rec.chineseMeaning}
                            </p>
                          )}
                          <p className="font-serif text-sm text-[#7A7873]">
                            <span className="mr-2 font-mono text-[11px] text-[#ACA79C]">
                              You:
                            </span>
                            <span>{rec.userSentence}</span>
                          </p>
                        </div>

                        {/* Bottom Row: Newsreader Serif Examiner Band 8.0 Rewrite */}
                        <p className="mt-2 font-serif text-[16px] leading-relaxed text-[#2C2A29]">
                          <span
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="mr-2 font-mono text-[11px] font-medium text-[#8C867E]"
                          >
                            Band 8.0:
                          </span>
                          {renderTextWithHighlights(
                            rec.band8Sentence,
                            rec.highlights,
                            { parseMarkdownBoldOrange: true }
                          )}
                        </p>

                        {/* Expandable Full Details when clicking the history row */}
                        {isExpanded && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="mt-4 space-y-3 border-t border-dashed border-[#DFDBD1] pt-3.5 cursor-default"
                          >
                            {rec.diagnosis && (
                              <div className="font-sans text-xs leading-relaxed text-[#5C5852]">
                                <span className="mr-2 font-mono text-[11px] font-medium text-[#8C867E]">
                                  诊断:
                                </span>
                                {renderTextWithHighlights(
                                  rec.diagnosis,
                                  rec.highlights
                                )}
                              </div>
                            )}

                            {rec.band7Sentence && (
                              <div className="font-serif text-[15px] leading-relaxed text-[#2C2A29]">
                                <span
                                  style={{
                                    fontVariantNumeric:
                                      'lining-nums tabular-nums',
                                  }}
                                  className="mr-2 font-mono text-[11px] font-medium text-[#8C867E]"
                                >
                                  Band 7.0:
                                </span>
                                {renderTextWithHighlights(
                                  rec.band7Sentence,
                                  rec.highlights,
                                  { parseMarkdownBoldOrange: true }
                                )}
                              </div>
                            )}

                            {rec.structureFormula && (
                              <div className="font-mono text-xs text-[#8C867E]">
                                Structure:{' '}
                                {renderTextWithHighlights(
                                  rec.structureFormula,
                                  rec.highlights
                                )}
                              </div>
                            )}

                            {Array.isArray(rec.lexicon) &&
                              rec.lexicon.length > 0 && (
                                <div className="space-y-2 pt-1">
                                  {rec.lexicon.map((lex, lIdx) => {
                                    const alreadyInBank = isWordInVocabBank(
                                      lex.word
                                    );
                                    return (
                                      <div
                                        key={`${lex.word}-${lIdx}`}
                                        className="flex flex-wrap items-center justify-between gap-2"
                                      >
                                        <div className="flex flex-wrap items-baseline gap-2">
                                          <span className="font-serif text-[15px] font-medium text-[#2C2A29]">
                                            {lex.word}
                                          </span>
                                          <span className="font-mono text-xs text-[#8C867E]">
                                            {lex.pos}
                                          </span>
                                          <span className="font-sans text-xs text-[#5C5852]">
                                            {lex.meaning}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={alreadyInBank}
                                          onClick={() =>
                                            handleIngestLexicon(lex)
                                          }
                                          className={
                                            alreadyInBank
                                              ? tactileMicroBtnDisabledClass
                                              : tactileMicroBtnClass
                                          }
                                        >
                                          {alreadyInBank ? '✓ 已入库' : '+ 入库'}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* =================================================================
              MAIN PRACTICE WORKBENCH VIEW: 纸面题型分类栏 + 打字机核心练习区
             ================================================================= */
          <div>
            <div className={toolbarClass}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <div className="skeuo-groove inline-flex items-center rounded-xl p-1" role="group" aria-label="练习任务">
                  {(['T1', 'T2'] as const).map((group) => (
                    <button
                      key={group}
                      type="button"
                      aria-pressed={taskGroup === group}
                      onClick={() => handleSelectGroup(group)}
                      className={filterButtonClass(taskGroup === group)}
                    >
                      {group === 'T1' ? 'Task 1' : 'Task 2'}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="练习题型">
                  {groupSubTypes.map((sub) => {
                    const isSelected =
                      !isFreeRewrite && currentSubTypeMeta.key === sub.key;
                    return (
                      <button
                        key={sub.key}
                        type="button"
                        onClick={() => handleSelectSubType(sub.key)}
                        aria-pressed={isSelected}
                        className={filterButtonClass(isSelected)}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={isFreeRewrite}
                  onClick={() => {
                    setErrorMsg(null);
                    setIsFreeRewrite((prev) => !prev);
                  }}
                  className={isFreeRewrite ? filterButtonClass(true) : tactileMicroBtnClass}
                >
                  自由改写
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setViewMode('history');
                  }}
                  className={tactileMicroBtnClass}
                >
                  历史记录 <span className="font-mono">({sentenceHistory.length})</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[45%_55%]">
              <section className="flex min-w-0 flex-col border-b border-[#E6E1D8] lg:border-b-0 lg:border-r">
                <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-2 border-b border-[#ECE8DF] px-4 py-3 sm:px-7">
                  <h2 className="font-sans text-xs font-semibold text-[#2C2A29]">练习题目</h2>
                  <span className="font-mono text-[11px] tabular-nums text-[#8C867E]">{nameplateText}</span>
                </div>

                <div className="flex-1 px-4 py-5 sm:px-7 sm:py-6">
                  {latestRecordForCurrentQuestion && (
                    <p className="mb-3 inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-[#8C867E]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                      已练 · Band {latestRecordForCurrentQuestion.bandScore.toFixed(1)}
                    </p>
                  )}
                  {!isFreeRewrite && currentQuestion && (
                    <>
                      <p className="break-words font-sans text-[15px] font-medium leading-relaxed text-[#2C2A29]">
                        {currentQuestion.chineseMeaning}
                      </p>
                      <div className="mt-4 border-t border-[#ECE8DF] pt-3">
                        <p className="mb-1 font-mono text-[11px] text-[#8C867E]">原句</p>
                        <p className="break-words font-serif text-[18px] leading-relaxed text-[#5C5852]">
                          {currentQuestion.rawLowBandSentence}
                        </p>
                        {currentQuestion.targetWord && (
                          <p className="mt-3 break-words font-mono text-xs text-[#8C867E]">
                            目标词 · <span className="font-medium text-[#2C2A29]">{currentQuestion.targetWord}</span>
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  {isFreeRewrite && (
                    <p className="font-sans text-sm leading-relaxed text-[#8C867E]">
                      提交一句英文，查看诊断与两种改写示例。
                    </p>
                  )}
                </div>

                <div className="flex min-h-[68px] flex-wrap items-center gap-2 border-t border-[#ECE8DF] px-4 py-3 sm:px-7">
                  <button
                    type="button"
                    disabled={isGeneratingQuestion}
                    onClick={handleGenerateVocabQuestion}
                    className={`${tactileMicroBtnClass} disabled:opacity-50`}
                  >
                    {isGeneratingQuestion ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-[#EA5B25]" />
                        <span>出题中...</span>
                      </>
                    ) : (
                      <span>↻ 用生词出题</span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleNextQuestion}
                    className={tactileMicroBtnClass}
                  >
                    下一题 →
                  </button>
                </div>
              </section>

              <section className="flex min-w-0 flex-col">
                <div className="flex min-h-[54px] items-center border-b border-[#ECE8DF] px-4 py-3 sm:px-7">
                  <label htmlFor="micro-practice-sentence" className="font-sans text-xs font-semibold text-[#2C2A29]">
                    {isFreeRewrite ? '英文原句' : '改写书写区'}
                  </label>
                </div>
                <div className="flex-1 px-4 py-5 sm:px-7 sm:py-6">
                  <textarea
                    id="micro-practice-sentence"
                    ref={textareaRef}
                    rows={2}
                    value={userSentence}
                    onChange={(e) => {
                      setUserSentence(e.target.value);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(64, el.scrollHeight)}px`;
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleEvaluateSentence();
                      }
                    }}
                    placeholder={isFreeRewrite ? '输入要修改的英文句子' : '在此输入你的英文改写'}
                    className="block min-h-24 w-full resize-none overflow-hidden border-0 border-b border-[#DCD6CC] bg-transparent pb-3 font-serif text-[19px] leading-relaxed text-[#2C2A29] transition-colors placeholder:font-sans placeholder:text-sm placeholder:text-[#8C867E] focus:border-[#EA5B25] focus:outline-none"
                  />

                  {errorMsg && (
                    <p role="alert" className="mt-2 font-sans text-xs text-[#EA5B25]">
                      {errorMsg}
                    </p>
                  )}
                </div>
                <div className="flex min-h-[68px] items-center justify-end border-t border-[#ECE8DF] px-4 py-3 sm:px-7">
                  <button
                    type="button"
                    disabled={isEvaluating}
                    onClick={handleEvaluateSentence}
                    className={`skeuo-btn-orange inline-flex min-h-9 items-center gap-2 rounded-xl px-5 py-2 font-sans text-xs font-semibold text-white disabled:opacity-60 ${keyboardFocusClass}`}
                  >
                    {isEvaluating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>批改中...</span>
                      </>
                    ) : (
                      <span>批改这一句</span>
                    )}
                  </button>
                </div>
              </section>
            </div>

            {/* 三、考官三阶批改反馈（原地展开、瑞士网格对齐 + 划词马克笔高亮） */}
            {activeEvaluation && (
              <div
                ref={feedbackContainerRef}
                className="relative border-t border-[#E6E1D8] px-4 py-6 sm:px-8"
              >
                <SelectionHighlightPopover
                  containerRef={feedbackContainerRef}
                  aiConfig={aiConfig}
                  sourceLabel={`小练习 · ${taskGroupTitle} ${currentSubTypeMeta.label}`}
                  isTextHighlighted={isMicroTextHighlighted}
                  onApplyHighlight={handleApplyMicroHighlight}
                  onEraseHighlight={handleEraseMicroHighlight}
                  onIngestVocab={onIngestVocab}
                  onExcerptToNotes={onExcerptToNotes}
                  onOpenApiKeyModal={onOpenApiKeyModal}
                />

                <div className="space-y-6">
                  {/* 1. Diagnosis · 诊断（附带等高对齐分数 ● Band 6.0） */}
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                    <div className="flex items-baseline justify-between sm:justify-start sm:gap-2.5">
                      <span className="font-mono text-xs tracking-wider text-[#8C867E]">
                        Diagnosis · 诊断
                      </span>
                    </div>

                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-sans text-sm leading-relaxed text-[#2C2A29]">
                        {renderTextWithHighlights(
                          activeEvaluation.diagnosis,
                          activeEvaluation.highlights
                        )}
                      </p>
                      <span
                        style={{
                          fontVariantNumeric: 'lining-nums tabular-nums',
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs font-semibold text-[#262523]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                        <span>Band {activeEvaluation.band.toFixed(1)}</span>
                      </span>
                    </div>
                  </div>

                  {/* 2. Band 7.0 · 顺畅修改 */}
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                    <span
                      style={{
                        fontVariantNumeric: 'lining-nums tabular-nums',
                      }}
                      className="font-mono text-xs tracking-wider text-[#8C867E]"
                    >
                      Band 7.0 · 顺畅修改
                    </span>

                    <p className="font-serif text-[17px] leading-relaxed text-[#2C2A29]">
                      {renderTextWithHighlights(
                        activeEvaluation.band7Sentence,
                        activeEvaluation.highlights,
                        { parseMarkdownBoldOrange: true }
                      )}
                    </p>
                  </div>

                  {/* 3. Band 8.0 · 高分重写 + Structure 公式 + + 摘录至笔记 */}
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                    <span
                      style={{
                        fontVariantNumeric: 'lining-nums tabular-nums',
                      }}
                      className="font-mono text-xs tracking-wider text-[#8C867E]"
                    >
                      Band 8.0 · 高分重写
                    </span>

                    <div>
                      <p className="font-serif text-[17px] leading-relaxed text-[#2C2A29]">
                        {renderTextWithHighlights(
                          activeEvaluation.band8Sentence,
                          activeEvaluation.highlights,
                          { parseMarkdownBoldOrange: true }
                        )}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        {activeEvaluation.structureFormula ? (
                          <p className="font-mono text-xs leading-relaxed text-[#8C867E]">
                            Structure:{' '}
                            {renderTextWithHighlights(
                              activeEvaluation.structureFormula,
                              activeEvaluation.highlights
                            )}
                          </p>
                        ) : (
                          <span />
                        )}

                        {onExcerptToNotes &&
                          (() => {
                            const excerptSourceKey = `mp:${activeQuestionKey}:${activeEvaluation.band8Sentence.slice(0, 40)}`;
                            const isExcerpted =
                              excerptedKeys?.has(excerptSourceKey) ?? false;

                            const handleExcerptClick = () => {
                              if (isExcerpted) return;
                              const headerTag = isFreeRewrite
                                ? `${taskGroupTitle} · ${currentSubTypeMeta.label} · 自由改写`
                                : `${taskGroupTitle} · ${currentSubTypeMeta.label}${
                                    currentQuestion?.targetWord
                                      ? ` · Target: ${currentQuestion.targetWord}`
                                      : ''
                                  }`;
                              const lines = [
                                `## 【小练习复盘】${headerTag}（Band ${activeEvaluation.band.toFixed(1)} ➔ 8.0）`,
                                ...(!isFreeRewrite &&
                                currentQuestion?.chineseMeaning
                                  ? [
                                      `- 中文原意：${currentQuestion.chineseMeaning}`,
                                    ]
                                  : []),
                                `- 您的原句：${userSentence.trim()}`,
                                `- 考官诊断：${activeEvaluation.diagnosis}`,
                                `- Band 8.0 重写：${activeEvaluation.band8Sentence}`,
                                ...(activeEvaluation.structureFormula
                                  ? [
                                      `> Structure: ${activeEvaluation.structureFormula}`,
                                    ]
                                  : []),
                              ];
                              onExcerptToNotes({
                                sourceKey: excerptSourceKey,
                                markdownBlock: lines.join('\n'),
                              });
                            };

                            return (
                              <button
                                type="button"
                                disabled={isExcerpted}
                                onClick={handleExcerptClick}
                                className={`shrink-0 ${
                                  isExcerpted
                                    ? tactileMicroBtnDisabledClass
                                    : tactileMicroBtnClass
                                }`}
                              >
                                {isExcerpted ? '✓ 已摘录' : '+ 摘录至笔记'}
                              </button>
                            );
                          })()}
                      </div>
                    </div>
                  </div>

                  {/* 4. Lexicon · 重点词伙 */}
                  {activeEvaluation.lexicon.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                      <span className="font-mono text-xs tracking-wider text-[#8C867E]">
                        Lexicon · 重点词伙
                      </span>

                      <div className="space-y-2.5">
                        {activeEvaluation.lexicon.map((lex, idx) => {
                          const alreadyInBank = isWordInVocabBank(lex.word);
                          return (
                            <div
                              key={`${lex.word}-${idx}`}
                              className="flex flex-wrap items-center justify-between gap-3"
                            >
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="font-serif text-[16px] font-medium text-[#2C2A29]">
                                  {lex.word}
                                </span>
                                <span className="font-mono text-xs text-[#8C867E]">
                                  {lex.pos}
                                </span>
                                <span className="font-sans text-xs text-[#5C5852]">
                                  {lex.meaning}
                                </span>
                              </div>

                              <button
                                type="button"
                                disabled={alreadyInBank}
                                onClick={() => handleIngestLexicon(lex)}
                                className={`shrink-0 ${
                                  alreadyInBank
                                    ? tactileMicroBtnDisabledClass
                                    : tactileMicroBtnClass
                                }`}
                              >
                                {alreadyInBank ? '✓ 已入库' : '+ 入库'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
