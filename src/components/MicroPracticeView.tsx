import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { DeepSeekConfig, VocabularyCard } from '../types/ielts';
import {
  BUILTIN_MICRO_QUESTIONS,
  evaluateMicroPracticeSentence,
  generateVocabMicroQuestion,
  MICRO_PRACTICE_SUBTYPES,
  MicroPracticeEvaluation,
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
  onOpenApiKeyModal?: () => void;
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

export const MicroPracticeView: React.FC<MicroPracticeViewProps> = ({
  aiConfig,
  vocabCards,
  onIngestVocab,
  onOpenApiKeyModal,
}) => {
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

  // Draft input text per question ID (or 'free_rewrite' when in free mode)
  const [draftsByKey, setDraftsByKey] = useLocalStorage<Record<string, string>>(
    'ielts_micro_practice_drafts_v1',
    {}
  );

  // Cached evaluations per question ID (or 'free_rewrite')
  const [evaluationsByKey, setEvaluationsByKey] = useLocalStorage<
    Record<string, MicroPracticeEvaluation>
  >('ielts_micro_practice_evals_v1', {});

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

  const activeDraftKey = isFreeRewrite
    ? `free_${currentSubTypeMeta.key}`
    : currentQuestion?.id || 'default';

  const userSentence = draftsByKey[activeDraftKey] || '';
  const activeEvaluation = evaluationsByKey[activeDraftKey] || null;

  // Auto-resize typewriter textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(64, el.scrollHeight)}px`;
  }, [userSentence, activeDraftKey, isFreeRewrite]);

  // Check if a lexicon word is already in the user's vocabulary bank
  const isWordInVocabBank = (word: string): boolean => {
    const norm = word.trim().toLowerCase();
    return vocabCards.some((c) => c.word.trim().toLowerCase() === norm);
  };

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

  // Evaluate current sentence with deepseek-v4-pro [ 批改这一句 ]
  const handleEvaluateSentence = async () => {
    setErrorMsg(null);
    if (!userSentence.trim()) {
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
        userSentence,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
      });

      setEvaluationsByKey((prev) => ({
        ...prev,
        [activeDraftKey]: result,
      }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : '批改请求失败，请检查网络或 API Key。'
      );
    } finally {
      setIsEvaluating(false);
    }
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

        {/* ===================================================================
            一、纸面顶部单行「题型分类栏」
            Left: T1 / T2 micro switch + 4 core sub-types | Right: [ 自由改写 ]
           =================================================================== */}
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

            <span className="h-3.5 w-[1px] bg-[#E2DFD5]" aria-hidden="true" />

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

        {/* ===================================================================
            二、纸面核心练习区（克制留白、打字机质感，无内嵌小卡片或灰底框）
           =================================================================== */}
        <div className="px-8 py-8 sm:px-10">
          {/* 1. 第一层：微型铅字铭牌 + 切题触发器（单行两端对齐） */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
              className="font-mono text-xs tracking-wider text-[#8C867E]"
            >
              {nameplateText}
            </span>

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

          {/* 3. 第三层：无边框打字机输入槽 + 底部操作栏 */}
          <div className={isFreeRewrite ? 'mt-5' : 'mt-7'}>
            <textarea
              ref={textareaRef}
              rows={2}
              value={userSentence}
              onChange={(e) => {
                const nextVal = e.target.value;
                setDraftsByKey((prev) => ({
                  ...prev,
                  [activeDraftKey]: nextVal,
                }));
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

            <div className="mt-4 flex items-center justify-end">
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

          {/* =================================================================
              三、考官三阶批改反馈（原地展开、瑞士网格对齐）
              Strictly 2-column Swiss Grid alignment: Left Monospace Label | Right Content
             ================================================================= */}
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
                    style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
                    className="font-mono text-xs tracking-wider text-[#8C867E]"
                  >
                    BAND 7.0 · 顺畅修改
                  </span>

                  <p className="font-serif text-[17px] leading-relaxed text-[#2C2A29]">
                    {renderHighlightedSentence(activeEvaluation.band7Sentence)}
                  </p>
                </div>

                {/* 3. BAND 8.0 · 高分重写 + STRUCTURE 公式 */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-6">
                  <span
                    style={{ fontVariantNumeric: 'lining-nums tabular-nums' }}
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
                    {activeEvaluation.structureFormula && (
                      <p className="mt-1.5 font-mono text-xs leading-relaxed text-[#8C867E]">
                        STRUCTURE: {activeEvaluation.structureFormula}
                      </p>
                    )}
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
      </section>
    </div>
  );
};
