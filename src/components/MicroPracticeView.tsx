import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { DeepSeekConfig, VocabularyCard } from '../types/ielts';
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
import { useLocalStorage } from '../hooks/useLocalStorage';

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

  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
      return;
    }
    if (!currentQuestion) {
      setUserSentence('');
      setActiveEvaluation(null);
      return;
    }
    const matchedRecord = sentenceHistory.find(
      (rec) => rec.questionId === currentQuestion.id
    );
    if (matchedRecord) {
      setUserSentence(matchedRecord.userSentence);
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
      });
    } else {
      setUserSentence('');
      setActiveEvaluation(null);
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

      setActiveEvaluation(result);

      // Persist to localStorage ('ielts_studio_sentence_history')
      const newHistoryRecord: MicroPracticeHistoryRecord = {
        id: `mp-hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        setActiveEvaluation({
          band: record.bandScore,
          diagnosis: record.diagnosis,
          band7Sentence: record.band7Sentence,
          band7Highlights: [],
          band8Sentence: record.band8Sentence,
          structureFormula: record.structureFormula,
          lexicon: Array.isArray(record.lexicon) ? record.lexicon : [],
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
      setActiveEvaluation({
        band: record.bandScore,
        diagnosis: record.diagnosis,
        band7Sentence: record.band7Sentence,
        band7Highlights: [],
        band8Sentence: record.band8Sentence,
        structureFormula: record.structureFormula,
        lexicon: Array.isArray(record.lexicon) ? record.lexicon : [],
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
  const nameplateText = isFreeRewrite
    ? `TASK ${taskGroup === 'T1' ? '1' : '2'} · ${currentSubTypeMeta.enCode} · FREE REWRITE`
    : `TASK ${taskGroup === 'T1' ? '1' : '2'} · ${currentSubTypeMeta.enCode} · ${formattedIdx} / ${formattedTotal}`;

  return (
    <div className="mx-auto w-[92vw] max-w-[920px]">
      <section className="skeuo-paper overflow-hidden rounded-2xl">
        {/* Smartisan Vintage Double Crimson Header Rule */}
        <div className="pt-4">
          <div className="h-[2px] w-full bg-[#C97A63]/35" />
          <div className="mt-[2px] h-[1px] w-full bg-[#C97A63]/25" />
        </div>

        {viewMode === 'history' ? (
          /* =================================================================
              HISTORY ARCHIVE VIEW: 极简「小练习历史档案」视图
             ================================================================= */
          <div>
            {/* Top Header: Left [ ← 返回练习 ] | Center 小练习历史档案 | Right 全部 | T1 | T2 | 生词造句 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-8 py-4 font-sans">
              <button
                type="button"
                onClick={() => setViewMode('practice')}
                className="skeuo-btn-light rounded-lg px-3 py-1.5 font-sans text-xs font-medium text-[#262523]"
              >
                ← 返回练习
              </button>

              <span className="font-sans text-sm font-semibold tracking-tight text-[#262523]">
                小练习历史档案
              </span>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                {(
                  [
                    { key: 'ALL', label: '全部' },
                    { key: 'T1', label: 'T1' },
                    { key: 'T2', label: 'T2' },
                    { key: 'VOCAB', label: '生词造句' },
                  ] as const
                ).map((tab) => {
                  const isActive = historyFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setHistoryFilter(tab.key)}
                      className={`relative py-1 transition-colors ${
                        isActive
                          ? 'font-semibold text-[#262523] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#EA5B25]'
                          : 'text-[#8C867E] hover:text-[#262523]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* History List Body (Separated by thin stationery horizontal lines, zero nested card boxes) */}
            <div className="px-8 py-4 sm:px-10">
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
                        : `${rec.taskType} · ${getSubTypeLabel(rec.category)}`;

                    return (
                      <div
                        key={rec.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleLoadHistoryRecord(rec)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleLoadHistoryRecord(rec);
                          }
                        }}
                        className="group cursor-pointer py-5 transition-colors hover:bg-[#F4F1E8]/60 -mx-3 px-3 rounded-lg"
                      >
                        {/* Top Row: Left ● BAND x.x + Task Nameplate + TARGET | Right Timestamp + Hover Delete */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="flex flex-wrap items-center gap-3 font-mono text-xs"
                          >
                            <span className="inline-flex items-center gap-1.5 font-semibold text-[#262523]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                              <span>BAND {rec.bandScore.toFixed(1)}</span>
                            </span>

                            <span className="text-[#8C867E]">{catLabel}</span>

                            {rec.targetWord && (
                              <span className="font-medium text-[#EA5B25]">
                                TARGET: {rec.targetWord}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5">
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

                        {/* Middle Row: Muted gray Chinese meaning + User's sentence YOU: ... */}
                        <div className="mt-2 space-y-1">
                          {rec.chineseMeaning && (
                            <p className="font-sans text-xs text-[#8C867E]">
                              {rec.chineseMeaning}
                            </p>
                          )}
                          <p className="font-serif text-sm text-[#7A7873]">
                            <span className="mr-2 font-mono text-[11px] text-[#ACA79C]">
                              YOU:
                            </span>
                            <span>{rec.userSentence}</span>
                          </p>
                        </div>

                        {/* Bottom Row: Newsreader Serif Examiner BAND 8.0 Rewrite */}
                        <p className="mt-2 font-serif text-[16px] leading-relaxed text-[#2C2A29]">
                          <span
                            style={{
                              fontVariantNumeric: 'lining-nums tabular-nums',
                            }}
                            className="mr-2 font-mono text-[11px] font-medium text-[#8C867E]"
                          >
                            BAND 8.0:
                          </span>
                          {renderHighlightedSentence(rec.band8Sentence)}
                        </p>
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
            {/* 一、纸面顶部单行「题型分类栏」 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E3DA] px-8 py-4 font-sans">
              <div className="flex flex-wrap items-center gap-4">
                {/* Micro T1 / T2 Switcher */}
                <div className="inline-flex items-center rounded-lg bg-[#EFECE3] p-0.5">
                  {(['T1', 'T2'] as const).map((grp) => {
                    const active = taskGroup === grp;
                    return (
                      <button
                        key={grp}
                        type="button"
                        onClick={() => handleSelectGroup(grp)}
                        className={`rounded-md px-2.5 py-1 font-mono text-xs transition-all ${
                          active
                            ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                            : 'text-[#8C867E] hover:text-[#262523]'
                        }`}
                      >
                        {grp}
                      </button>
                    );
                  })}
                </div>

                <span
                  className="h-3.5 w-[1px] bg-[#E2DFD5]"
                  aria-hidden="true"
                />

                {/* 4 Core Sub-Types for the active T1 / T2 Group */}
                <div className="flex flex-wrap items-center gap-5">
                  {groupSubTypes.map((sub) => {
                    const isSelected =
                      !isFreeRewrite && currentSubTypeMeta.key === sub.key;
                    return (
                      <button
                        key={sub.key}
                        type="button"
                        onClick={() => handleSelectSubType(sub.key)}
                        className={`relative py-1 text-xs transition-colors ${
                          isSelected
                            ? 'font-semibold text-[#262523] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#EA5B25]'
                            : 'text-[#8C867E] hover:text-[#262523]'
                        }`}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Rightmost: [ 自由改写 ] Toggle */}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setIsFreeRewrite((prev) => !prev);
                }}
                className={`relative py-1 font-sans text-xs transition-colors ${
                  isFreeRewrite
                    ? 'font-semibold text-[#262523] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[#EA5B25]'
                    : 'text-[#8C867E] hover:text-[#262523]'
                }`}
              >
                [ 自由改写 ]
              </button>
            </div>

            {/* 二、纸面核心练习区（克制留白、打字机质感） */}
            <div className="px-8 py-8 sm:px-10">
              {/* 1. 第一层：微型铅字铭牌 + 已练状态标识 + 切题触发器（单行两端对齐） */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
                  className="flex flex-wrap items-center gap-3 font-mono text-xs"
                >
                  <span className="tracking-wider text-[#8C867E]">
                    {nameplateText}
                  </span>

                  {latestRecordForCurrentQuestion && (
                    <span className="inline-flex items-center gap-1.5 text-[#262523]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                      <span>
                        已练 (BAND{' '}
                        {latestRecordForCurrentQuestion.bandScore.toFixed(1)})
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 font-sans text-xs">
                  <button
                    type="button"
                    disabled={isGeneratingQuestion}
                    onClick={handleGenerateVocabQuestion}
                    className="inline-flex items-center gap-1 text-[#8C867E] transition-colors hover:text-[#EA5B25] disabled:opacity-50"
                  >
                    {isGeneratingQuestion ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-[#EA5B25]" />
                        <span>出题中...</span>
                      </>
                    ) : (
                      <span>[ ↻ 用生词出题 ]</span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleNextQuestion}
                    className="text-[#8C867E] transition-colors hover:text-[#262523]"
                  >
                    [ 下一题 → ]
                  </button>
                </div>
              </div>

              {/* 2. 第二层：题目原句（中文意思 + 5.5分低分句对照；自由改写模式下隐藏预设题目） */}
              {!isFreeRewrite && currentQuestion && (
                <div className="mt-6">
                  <p className="font-sans text-[15px] font-medium leading-relaxed text-[#2C2A29]">
                    {currentQuestion.chineseMeaning}
                  </p>

                  <p className="mt-2 font-serif text-[17px] italic leading-relaxed text-[#8C867E]">
                    <span className="mr-2 font-mono text-[11px] not-italic tracking-wider text-[#ACA79C]">
                      RAW
                    </span>
                    <span>{currentQuestion.rawLowBandSentence}</span>
                    {currentQuestion.targetWord && (
                      <span className="ml-3 inline-block font-mono text-xs not-italic font-medium text-[#EA5B25]">
                        TARGET: {currentQuestion.targetWord}
                      </span>
                    )}
                  </p>
                </div>
              )}

              {/* 3. 第三层：无边框打字机输入槽 + 底部左右对称操作栏 */}
              <div className={isFreeRewrite ? 'mt-5' : 'mt-7'}>
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={userSentence}
                  onChange={(e) => {
                    setUserSentence(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleEvaluateSentence();
                    }
                  }}
                  placeholder={
                    isFreeRewrite
                      ? '直接输入任意需要升格的英文句子...'
                      : '在此输入您的高分改写句...'
                  }
                  className="w-full resize-none border-0 border-b border-[#D8D3C8] bg-transparent pb-3 font-serif text-[19px] leading-relaxed text-[#2C2A29] placeholder:font-serif placeholder:italic placeholder:text-[#B8B2A6] focus:border-[#EA5B25] focus:outline-none transition-colors"
                />

                {errorMsg && (
                  <p className="mt-2 font-sans text-xs text-[#EA5B25]">
                    {errorMsg}
                  </p>
                )}

                {/* Bottom Symmetrical Action Bar: Left [ 历史记录 (x) ] | Right [ 批改这一句 ] */}
                <div className="mt-4 flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setViewMode('history');
                    }}
                    style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
                    className="font-mono text-xs text-[#8C867E] transition-colors hover:text-[#262523]"
                  >
                    [ 历史记录 ({sentenceHistory.length}) ]
                  </button>

                  <button
                    type="button"
                    disabled={isEvaluating}
                    onClick={handleEvaluateSentence}
                    className="skeuo-btn-orange inline-flex items-center gap-2 rounded-lg px-4 py-2 font-sans text-xs font-semibold tracking-wide text-white disabled:opacity-60"
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
              </div>

              {/* 三、考官三阶批改反馈（原地展开、瑞士网格对齐） */}
              {activeEvaluation && (
                <div className="mt-8 border-t border-dashed border-[#D8D3C8] pt-7">
                  <div className="space-y-6">
                    {/* 1. DIAGNOSIS · 诊断（附带等高对齐分数 ● BAND 6.0） */}
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                      <div className="flex items-baseline justify-between sm:justify-start sm:gap-2.5">
                        <span className="font-mono text-xs tracking-wider text-[#8C867E]">
                          DIAGNOSIS · 诊断
                        </span>
                      </div>

                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-sans text-sm leading-relaxed text-[#2C2A29]">
                          {activeEvaluation.diagnosis}
                        </p>
                        <span
                          style={{
                            fontVariantNumeric: 'lining-nums tabular-nums',
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs font-semibold text-[#262523]"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
                          <span>BAND {activeEvaluation.band.toFixed(1)}</span>
                        </span>
                      </div>
                    </div>

                    {/* 2. BAND 7.0 · 顺畅修改 */}
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                      <span
                        style={{
                          fontVariantNumeric: 'lining-nums tabular-nums',
                        }}
                        className="font-mono text-xs tracking-wider text-[#8C867E]"
                      >
                        BAND 7.0 · 顺畅修改
                      </span>

                      <p className="font-serif text-[17px] leading-relaxed text-[#2C2A29]">
                        {renderHighlightedSentence(
                          activeEvaluation.band7Sentence
                        )}
                      </p>
                    </div>

                    {/* 3. BAND 8.0 · 高分重写 + STRUCTURE 公式 + [ + 摘录至笔记 ] */}
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                      <span
                        style={{
                          fontVariantNumeric: 'lining-nums tabular-nums',
                        }}
                        className="font-mono text-xs tracking-wider text-[#8C867E]"
                      >
                        BAND 8.0 · 高分重写
                      </span>

                      <div>
                        <p className="font-serif text-[17px] leading-relaxed text-[#2C2A29]">
                          {renderHighlightedSentence(
                            activeEvaluation.band8Sentence
                          )}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-3">
                          {activeEvaluation.structureFormula ? (
                            <p className="font-mono text-xs leading-relaxed text-[#8C867E]">
                              STRUCTURE: {activeEvaluation.structureFormula}
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
                                  ? `${taskGroup} · ${currentSubTypeMeta.label} · 自由改写`
                                  : `${taskGroup} · ${currentSubTypeMeta.label}${
                                      currentQuestion?.targetWord
                                        ? ` · TARGET: ${currentQuestion.targetWord}`
                                        : ''
                                    }`;
                                const lines = [
                                  `## 【小练习复盘】${headerTag}（BAND ${activeEvaluation.band.toFixed(1)} ➔ 8.0）`,
                                  ...( !isFreeRewrite &&
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
                                        `> STRUCTURE: ${activeEvaluation.structureFormula}`,
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
                                  className={`shrink-0 font-mono text-xs transition-colors ${
                                    isExcerpted
                                      ? 'cursor-default text-[#ACA79C]'
                                      : 'text-[#8C867E] hover:text-[#EA5B25]'
                                  }`}
                                >
                                  {isExcerpted
                                    ? '✓ 已摘录'
                                    : '[ + 摘录至笔记 ]'}
                                </button>
                              );
                            })()}
                        </div>
                      </div>
                    </div>

                    {/* 4. LEXICON · 重点词伙 */}
                    {activeEvaluation.lexicon.length > 0 && (
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                        <span className="font-mono text-xs tracking-wider text-[#8C867E]">
                          LEXICON · 重点词伙
                        </span>

                        <div className="space-y-2">
                          {activeEvaluation.lexicon.map((lex, idx) => {
                            const alreadyInBank = isWordInVocabBank(lex.word);
                            return (
                              <div
                                key={`${lex.word}-${idx}`}
                                className="flex flex-wrap items-baseline justify-between gap-3"
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
                                  className={`shrink-0 font-mono text-xs transition-colors ${
                                    alreadyInBank
                                      ? 'cursor-default text-[#ACA79C]'
                                      : 'text-[#8C867E] hover:text-[#EA5B25]'
                                  }`}
                                >
                                  {alreadyInBank ? '[ 已入库 ]' : '[ + 入库 ]'}
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
          </div>
        )}
      </section>
    </div>
  );
};
