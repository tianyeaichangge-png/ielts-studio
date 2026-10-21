import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Volume2,
  Check,
  AlertCircle,
  Eye,
  Keyboard,
  BookOpen,
  Sparkles,
  Trash2,
  X,
  Loader2,
  Search,
} from 'lucide-react';
import {
  DeepSeekConfig,
  MasteryStatus,
  VocabularyCard,
} from '../types/ielts';
import { generateVocabularyCardsWithAI } from '../lib/geminiEvaluator';

interface VocabularyModuleProps {
  cards: VocabularyCard[];
  onUpdateStatus: (id: string, status: MasteryStatus) => void;
  aiConfig: DeepSeekConfig;
  onAddCards: (
    newCards: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>[]
  ) => number;
  onDeleteCard: (id: string) => void;
  onOpenApiKeyModal: () => void;
}

type StudyMode = 'recognize' | 'spell';
type SpellCheckStatus = 'idle' | 'correct' | 'wrong';
type WordBoxCategory = 'all' | 'writing' | 'task1' | 'task2';

const WORD_BOX_TABS: {
  id: WordBoxCategory;
  label: string;
}[] = [
  { id: 'all', label: '全部' },
  { id: 'writing', label: '✍️ 写作积累' },
  { id: 'task1', label: '📊 Task 1 核心词' },
  { id: 'task2', label: '💡 Task 2 学术词' },
];

const FALLBACK_PHONETIC_DICT: Record<string, { phonetic: string; pos: string }> = {
  categories: { phonetic: '/ˈkætəɡəriz/', pos: 'n.' },
  category: { phonetic: '/ˈkætəɡəri/', pos: 'n.' },
  proportion: { phonetic: '/prəˈpɔːʃn/', pos: 'n.' },
  significantly: { phonetic: '/sɪɡˈnɪfɪkəntli/', pos: 'adv.' },
  dramatically: { phonetic: '/drəˈmætɪkli/', pos: 'adv.' },
};

/**
 * Resolves which word-box category a card belongs to.
 */
function getCardBoxCategory(card: VocabularyCard): 'writing' | 'task1' | 'task2' {
  if (card.vocabCategory) return card.vocabCategory;
  if (card.fromWriting || card.isCustom) return 'writing';
  if (card.id.startsWith('task1-')) return 'task1';
  return 'task2';
}

/**
 * Ensures fake phonetics like "/academic/", "/phrase/", "/collocation/" are NEVER rendered.
 */
function getValidPhonetic(card: VocabularyCard): string {
  const lower = card.word.trim().toLowerCase();
  if (FALLBACK_PHONETIC_DICT[lower]) {
    return FALLBACK_PHONETIC_DICT[lower].phonetic;
  }
  const raw = (card.phonetic || '').trim();
  if (!raw) return '';
  if (/academic|phrase|collocation|expr/i.test(raw)) return '';
  // Multi-word phrases without genuine IPA symbols should hide phonetic text
  if (card.word.trim().includes(' ') && !/[ˈˌɪʊɔːəɜːæʌɑːɒʃʒθðŋ]/.test(raw)) {
    return '';
  }
  return raw;
}

/**
 * Ensures fake POS tags like "acad." or "expr." are NEVER rendered.
 */
function getValidPos(card: VocabularyCard): string {
  const lower = card.word.trim().toLowerCase();
  if (FALLBACK_PHONETIC_DICT[lower]) {
    return FALLBACK_PHONETIC_DICT[lower].pos;
  }
  const raw = (card.partOfSpeech || '').trim();
  if (!raw || /^(acad\.|expr\.)$/i.test(raw)) {
    return card.word.trim().includes(' ') ? 'phrase' : 'n.';
  }
  return raw;
}

/**
 * Extracts the user's original misspelled or low-band word from a writing-ingested card.
 */
function getOriginalErrorText(card: VocabularyCard): string | null {
  if (!card.fromWriting) return null;
  const candidate = (card.originalError || '').trim();
  if (
    candidate &&
    candidate.toLowerCase() !== card.word.trim().toLowerCase() &&
    candidate.length <= 42
  ) {
    return candidate;
  }
  const match = card.exampleTranslation?.match(/将\s*[“"]([^”"]+)[”"]\s*升级为/);
  if (
    match?.[1] &&
    match[1].trim().toLowerCase() !== card.word.trim().toLowerCase()
  ) {
    return match[1].trim();
  }
  return null;
}

/**
 * Masks the target word in the example sentence with "_______" for Spelling Mode.
 */
function maskTargetWordInSentence(sentence: string, targetWord: string): string {
  if (!sentence || !targetWord) return sentence;
  const cleanTarget = targetWord.trim();
  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
  if (exactRegex.test(sentence)) {
    return sentence.replace(exactRegex, '_______');
  }
  // If inflected or multi-word, try masking stem (first 5+ chars)
  if (cleanTarget.length >= 5 && !cleanTarget.includes(' ')) {
    const stem = cleanTarget.slice(0, Math.max(4, cleanTarget.length - 2));
    const stemEscaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stemRegex = new RegExp(`\\b${stemEscaped}[a-z]*\\b`, 'gi');
    if (stemRegex.test(sentence)) {
      return sentence.replace(stemRegex, '_______');
    }
  }
  return sentence;
}

/**
 * Synthesizes a subtle, tactile Web Audio mechanical tone for correct/wrong spelling feedback.
 */
function playFeedbackTone(type: 'correct' | 'wrong') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'correct') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.07); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.setValueAtTime(150, now + 0.08);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  } catch {
    // ignore audio context restrictions
  }
}

export const VocabularyModule: React.FC<VocabularyModuleProps> = ({
  cards,
  onUpdateStatus,
  aiConfig,
  onAddCards,
  onDeleteCard,
  onOpenApiKeyModal,
}) => {
  const [selectedCategory, setSelectedCategory] =
    useState<WordBoxCategory>('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [studyMode, setStudyMode] = useState<StudyMode>('recognize');

  // Recognize Mode state: whether Chinese meaning & original error warning are revealed
  const [isMeaningRevealed, setIsMeaningRevealed] = useState(false);

  // Spelling Mode states
  const [typedInput, setTypedInput] = useState('');
  const [spellStatus, setSpellStatus] = useState<SpellCheckStatus>('idle');
  const [shakeKey, setShakeKey] = useState(0);
  const [hasRecordedMistakeThisCard, setHasRecordedMistakeThisCard] =
    useState(false);

  // Drawer states ([ 📑 词表与添词 ])
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [aiRawInput, setAiRawInput] = useState('');
  const [aiTargetCategory, setAiTargetCategory] = useState<
    'writing' | 'task1' | 'task2'
  >('writing');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiFeedbackMsg, setAiFeedbackMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [drawerSearchQuery, setDrawerSearchQuery] = useState('');

  const spellInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  // Counts per word-box category
  const categoryCounts = useMemo(() => {
    const counts: Record<WordBoxCategory, number> = {
      all: cards.length,
      writing: 0,
      task1: 0,
      task2: 0,
    };
    for (const card of cards) {
      const cat = getCardBoxCategory(card);
      counts[cat] += 1;
    }
    return counts;
  }, [cards]);

  // Filtered cards for the active word-box
  const filteredCards = useMemo(() => {
    if (selectedCategory === 'all') return cards;
    return cards.filter((c) => getCardBoxCategory(c) === selectedCategory);
  }, [cards, selectedCategory]);

  const total = filteredCards.length;
  const safeIndex = total > 0 ? currentIndex % total : 0;
  const activeCard = filteredCards[safeIndex] || null;

  const formattedIndex = total > 0 ? String(safeIndex + 1).padStart(2, '0') : '00';
  const formattedTotal = String(total).padStart(2, '0');

  const validPhonetic = useMemo(
    () => (activeCard ? getValidPhonetic(activeCard) : ''),
    [activeCard]
  );
  const validPos = useMemo(
    () => (activeCard ? getValidPos(activeCard) : ''),
    [activeCard]
  );
  const originalErrorText = useMemo(
    () => (activeCard ? getOriginalErrorText(activeCard) : null),
    [activeCard]
  );

  // Sync AI target category when user switches word-box
  useEffect(() => {
    if (selectedCategory !== 'all') {
      setAiTargetCategory(selectedCategory);
    }
  }, [selectedCategory]);

  // Pure British English (en-GB) Web Speech API pronunciation
  const handleSpeak = useCallback((text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.92;
      const voices = window.speechSynthesis.getVoices();
      const gbVoice = voices.find(
        (v) =>
          v.lang === 'en-GB' ||
          v.lang.startsWith('en-GB') ||
          /UK|British/i.test(v.name)
      );
      if (gbVoice) {
        utterance.voice = gbVoice;
      }
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors
    }
  }, []);

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  // Reset card-specific states when switching card, category, or mode
  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setIsMeaningRevealed(false);
    setTypedInput('');
    setSpellStatus('idle');
    setHasRecordedMistakeThisCard(false);

    if (studyMode === 'spell' && activeCard && !isDrawerOpen) {
      const speakTimer = window.setTimeout(() => {
        handleSpeak(activeCard.word);
        spellInputRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(speakTimer);
    }
  }, [
    safeIndex,
    selectedCategory,
    studyMode,
    activeCard?.id,
    activeCard?.word,
    isDrawerOpen,
    handleSpeak,
  ]);

  const handleDecision = useCallback(
    (status: MasteryStatus) => {
      if (!activeCard || total === 0) return;
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      onUpdateStatus(activeCard.id, status);
      setIsMeaningRevealed(false);
      setTypedInput('');
      setSpellStatus('idle');
      setHasRecordedMistakeThisCard(false);
      setCurrentIndex((prev) => (prev + 1) % total);
    },
    [activeCard, onUpdateStatus, total]
  );

  // Check spelling when pressing Enter in Spelling Mode
  const handleVerifySpelling = useCallback(() => {
    if (!activeCard || total === 0) return;

    // If already verified as correct, pressing Enter immediately advances to next card
    if (spellStatus === 'correct') {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
      setCurrentIndex((prev) => (prev + 1) % total);
      return;
    }

    const target = activeCard.word.trim();
    const attempt = typedInput.trim();
    if (!attempt) return;

    if (attempt.toLowerCase() === target.toLowerCase()) {
      setSpellStatus('correct');
      setTypedInput(target);
      playFeedbackTone('correct');
      onUpdateStatus(
        activeCard.id,
        hasRecordedMistakeThisCard ? 'unlearned' : 'mastered'
      );

      autoAdvanceTimerRef.current = window.setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % total);
      }, 850);
    } else {
      setSpellStatus('wrong');
      setShakeKey((prev) => prev + 1);
      playFeedbackTone('wrong');
      if (!hasRecordedMistakeThisCard) {
        setHasRecordedMistakeThisCard(true);
        onUpdateStatus(activeCard.id, 'unlearned');
      }
    }
  }, [
    activeCard,
    spellStatus,
    typedInput,
    total,
    onUpdateStatus,
    hasRecordedMistakeThisCard,
  ]);

  // Tab key in Spelling Mode: Replay British English audio + reveal the next correct letter
  const handleTabHintAndReplay = useCallback(() => {
    if (!activeCard) return;
    const target = activeCard.word.trim();
    handleSpeak(target);

    if (spellStatus === 'correct') return;

    // Find longest matching prefix between current typedInput and target
    let matchLen = 0;
    while (
      matchLen < typedInput.length &&
      matchLen < target.length &&
      typedInput[matchLen].toLowerCase() === target[matchLen].toLowerCase()
    ) {
      matchLen++;
    }

    // Reveal the next character (and if the next char is a space, reveal the space + the following letter)
    let nextLen = Math.min(target.length, matchLen + 1);
    while (nextLen < target.length && target[nextLen - 1] === ' ') {
      nextLen++;
    }

    const nextSlice = target.slice(0, nextLen);
    setTypedInput(nextSlice);
    if (spellStatus === 'wrong') {
      setSpellStatus('idle');
    }
  }, [activeCard, handleSpeak, spellStatus, typedInput]);

  // Global keyboard shortcuts in Recognize Mode: Space to reveal/hide meaning, 1 for 没记住, 2 for 记住了
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isDrawerOpen || studyMode === 'spell') {
        return;
      }
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsMeaningRevealed((prev) => !prev);
      } else if (e.key === '1') {
        e.preventDefault();
        handleDecision('unlearned');
      } else if (e.key === '2') {
        e.preventDefault();
        handleDecision('mastered');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, studyMode, handleDecision]);

  // AI Smart Word Ingestion handler
  const handleAiIngestWords = async () => {
    const trimmed = aiRawInput.trim();
    if (!trimmed) {
      setAiFeedbackMsg({
        type: 'error',
        text: '请先输入要添加的英文单词或词组（多个词可用逗号或换行分隔）。',
      });
      return;
    }

    if (!aiConfig.apiKey.trim()) {
      setAiFeedbackMsg({
        type: 'error',
        text: '尚未配置 DeepSeek API Key，请先在右上角设置中填入 Key。',
      });
      onOpenApiKeyModal();
      return;
    }

    setIsAiGenerating(true);
    setAiFeedbackMsg(null);
    try {
      const generatedCards = await generateVocabularyCardsWithAI({
        rawInput: trimmed,
        targetCategory: aiTargetCategory,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
        model: aiConfig.model,
      });

      const addedCount = onAddCards(generatedCards);
      setAiRawInput('');
      setSelectedCategory(aiTargetCategory);
      setCurrentIndex(0);

      if (addedCount > 0) {
        setAiFeedbackMsg({
          type: 'success',
          text: `✓ 已由 DeepSeek 智能生成并收录 ${addedCount} 个词条（含真实音标、词性与雅思例句）！`,
        });
      } else {
        setAiFeedbackMsg({
          type: 'error',
          text: '输入的词条已存在于当前词库中，无需重复添加。',
        });
      }
    } catch (err) {
      setAiFeedbackMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'AI 智能添词失败，请稍后重试。',
      });
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Filtered list inside Drawer
  const drawerFilteredList = useMemo(() => {
    const q = drawerSearchQuery.trim().toLowerCase();
    return filteredCards.filter((card) => {
      if (!q) return true;
      return (
        card.word.toLowerCase().includes(q) ||
        card.chineseMeaning.toLowerCase().includes(q)
      );
    });
  }, [filteredCards, drawerSearchQuery]);

  const targetWord = activeCard ? activeCard.word.trim() : '';
  const isLongPhrase = targetWord.length > 16;
  const isMultiWord = targetWord.includes(' ');
  const maskedSentence = activeCard
    ? maskTargetWordInSentence(activeCard.exampleSentence, targetWord)
    : '';

  // Count non-space letters for the character progress indicator
  const totalLetterCount = targetWord.replace(/\s+/g, '').length;
  const typedLetterCount = Math.min(
    totalLetterCount,
    typedInput.replace(/\s+/g, '').length
  );

  // First-letter hint for multi-word phrases
  const multiWordHint = isMultiWord
    ? targetWord
        .split(/\s+/)
        .map((w) => `${w[0]}${'_'.repeat(Math.max(1, w.length - 1))}`)
        .join('  ')
    : null;

  return (
    <div className="relative flex min-h-[calc(100vh-120px)] flex-col items-center justify-center px-4 pb-16 pt-2 select-none">
      {/* =====================================================================
          TOP CATEGORY WORD-BOX FILTER BAR (分类词盒筛选栏)
         ===================================================================== */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        {WORD_BOX_TABS.map((tab) => {
          const isActive = selectedCategory === tab.id;
          const count = categoryCounts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSelectedCategory(tab.id);
                setCurrentIndex(0);
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs transition-all ${
                isActive
                  ? 'skeuo-btn-light font-semibold text-[#262523]'
                  : 'border border-transparent bg-[#EFECE4]/90 text-[#7A7873] hover:border-[#D6D2C4] hover:text-[#262523]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono text-[10px] ${
                  isActive ? 'text-[#EA5B25]' : 'text-[#9B978E]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tiny Braun Mechanical Counter */}
      <div className="mb-4 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
        <span className="font-mono text-xs font-medium tracking-[0.22em] text-[#7A7873]">
          {formattedIndex} / {formattedTotal}
        </span>
      </div>

      {/* =====================================================================
          MAIN VOCABULARY CARD OR EMPTY WORD-BOX STATE
         ===================================================================== */}
      {!activeCard ? (
        <div className="skeuo-paper flex min-h-[380px] w-full max-w-[540px] flex-col items-center justify-center rounded-2xl px-8 py-10 text-center">
          <p className="font-serif text-lg font-medium text-[#262523]">
            当前词盒暂无词条
          </p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-[#7A7873]">
            你可以在写作批改报告中点击「+ 入库」收集高分替换词，或直接点击下方按钮使用 AI 智能添词。
          </p>
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="skeuo-btn-light mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-[#262523]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#EA5B25]" />
            <span>打开 AI 智能添词</span>
          </button>
        </div>
      ) : (
        <>
          <div
            onClick={() => {
              if (studyMode === 'recognize') {
                setIsMeaningRevealed((prev) => !prev);
              } else {
                spellInputRef.current?.focus();
              }
            }}
            className={`skeuo-paper relative flex min-h-[380px] w-full max-w-[540px] flex-col justify-between rounded-2xl px-8 py-8 text-center transition-all sm:px-10 ${
              studyMode === 'recognize' ? 'cursor-pointer' : 'cursor-text'
            }`}
          >
            {/* TOP HEADER ROW: Left POS + Stamp | Right Braun Mode Switcher [ 认读 | 拼写 ] */}
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-[#7A7873]">
                {validPos && <span className="font-semibold">{validPos}</span>}
                {activeCard.fromWriting && (
                  <span className="rounded border border-[#D8D4C8] bg-[#F3F0E6] px-2 py-0.5 font-mono text-[10px] tracking-normal text-[#7A7873] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                    [ 来自写作批改 ]
                  </span>
                )}
                {!activeCard.fromWriting && activeCard.isCustom && (
                  <span className="rounded border border-[#D8D4C8] bg-[#F3F0E6] px-2 py-0.5 font-mono text-[10px] tracking-normal text-[#7A7873] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                    [ AI 添词 ]
                  </span>
                )}
              </div>

              {/* Right Top: Braun Two-State Micro Toggle [ 认读 | 拼写 ] */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="skeuo-groove inline-flex items-center rounded-lg p-0.5"
              >
                <button
                  type="button"
                  onClick={() => setStudyMode('recognize')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-all ${
                    studyMode === 'recognize'
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#7A7873] hover:text-[#262523]'
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  <span>认读</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStudyMode('spell')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] transition-all ${
                    studyMode === 'spell'
                      ? 'skeuo-switch-thumb font-semibold text-[#262523]'
                      : 'text-[#7A7873] hover:text-[#262523]'
                  }`}
                >
                  <Keyboard className="h-3 w-3" />
                  <span>拼写</span>
                </button>
              </div>
            </div>

            {/* =====================================================================
                MODE 1: RECOGNIZE MODE (认读模式)
               ===================================================================== */}
            {studyMode === 'recognize' ? (
              <div className="my-auto flex flex-col items-center py-4">
                <h1
                  className={`font-serif font-normal tracking-tight text-[#262523] ${
                    isLongPhrase
                      ? 'text-3xl sm:text-4xl leading-snug'
                      : 'text-5xl'
                  }`}
                >
                  {activeCard.word}
                </h1>

                {/* Phonetic (hidden if empty) + Pure en-GB Speaker Button */}
                <div className="mt-3.5 inline-flex items-center gap-2 text-[#7A7873]">
                  {validPhonetic && (
                    <span className="font-mono text-sm">{validPhonetic}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => handleSpeak(activeCard.word, e)}
                    className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                    title="朗读英式发音 (en-GB)"
                    aria-label="朗读英式发音"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Expandable Meaning + Original Error Warning (Click card or press Space) */}
                {isMeaningRevealed ? (
                  <div className="mt-5 w-full max-w-md space-y-2.5 rounded-xl border border-[#DFDBD0] bg-[#F4F1EA]/85 px-5 py-3.5 text-center transition-all">
                    <p className="text-base font-semibold text-[#262523]">
                      {activeCard.chineseMeaning}
                    </p>

                    {originalErrorText && (
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-[#E5C5B8] bg-[#FAF0EC] px-2.5 py-0.5 font-mono text-[11px] text-[#EA5B25]">
                        <span>原词误写/原表达：</span>
                        <span className="line-through font-semibold">
                          {originalErrorText}
                        </span>
                      </div>
                    )}

                    {activeCard.paraphrasing.length > 0 && (
                      <p className="font-serif text-xs text-[#7A7873]">
                        同义替换：{activeCard.paraphrasing.join(' / ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-5 font-mono text-[11px] tracking-wider text-[#B0ACA0]">
                    [ 点击卡片或按 Space 查看中文释义 ]
                  </div>
                )}
              </div>
            ) : (
              /* =====================================================================
                  MODE 2: SPELLING MODE (键盘拼写默写模式 — 无重复词性标签 + Tab 盲操提示)
                 ===================================================================== */
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  spellInputRef.current?.focus();
                }}
                className="my-auto flex w-full flex-col items-center py-3"
              >
                {/* Clue Header: Pure Chinese Meaning + Audio Replay Button (duplicate POS removed) */}
                <div className="flex flex-col items-center gap-1.5">
                  <div className="inline-flex items-center gap-2">
                    <span className="text-lg font-semibold tracking-tight text-[#262523]">
                      {activeCard.chineseMeaning}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleSpeak(activeCard.word, e)}
                      className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                      title="重播单词发音 (Tab 键亦可重播并提示下一字母)"
                      aria-label="重播单词发音"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {originalErrorText && (
                    <span className="font-mono text-[11px] text-[#7A7873]">
                      原词误写警示：
                      <span className="ml-1 text-[#EA5B25] line-through">
                        {originalErrorText}
                      </span>
                    </span>
                  )}

                  {multiWordHint && (
                    <span className="font-mono text-[11px] text-[#7A7873]">
                      词组提示：{multiWordHint}
                    </span>
                  )}
                </div>

                {/* Skeuomorphic Typewriter Spelling Slot */}
                <div
                  key={shakeKey}
                  className={`relative mt-5 w-full max-w-md rounded-xl border px-5 py-4 transition-all ${
                    spellStatus === 'correct'
                      ? 'border-[#2E7D5B] bg-[#EEF7F2] ring-2 ring-[#2E7D5B]/25'
                      : spellStatus === 'wrong'
                      ? 'animate-shake border-[#EA5B25] bg-[#FDF2EE] ring-2 ring-[#EA5B25]/25'
                      : 'border-[#CFCBC0] bg-[#F3F0E6] shadow-inner focus-within:border-[#262523]/50 focus-within:bg-[#FAF8F2]'
                  }`}
                >
                  {/* Hidden/Transparent Real Keyboard Input */}
                  <input
                    ref={spellInputRef}
                    type="text"
                    value={typedInput}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(e) => {
                      if (spellStatus === 'correct') return;
                      setTypedInput(e.target.value);
                      if (spellStatus === 'wrong') {
                        setSpellStatus('idle');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleVerifySpelling();
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleTabHintAndReplay();
                      }
                    }}
                    aria-label="拼写默写输入框"
                    className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
                  />

                  {/* Visual Typewriter Character Slots */}
                  <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 font-mono">
                    {targetWord.split('').map((targetChar, idx) => {
                      if (targetChar === ' ') {
                        return <span key={idx} className="w-3" />;
                      }

                      const userChar = typedInput[idx] || '';
                      const isCurrentCursor =
                        spellStatus !== 'correct' && idx === typedInput.length;
                      const isWrongCharHere =
                        spellStatus === 'wrong' &&
                        userChar.toLowerCase() !== targetChar.toLowerCase();

                      return (
                        <span
                          key={idx}
                          className={`inline-flex h-8 min-w-[20px] flex-col items-center justify-end border-b-2 px-0.5 text-lg font-bold leading-none transition-colors ${
                            spellStatus === 'correct'
                              ? 'border-[#2E7D5B] text-[#2E7D5B]'
                              : isWrongCharHere
                              ? 'border-[#EA5B25] text-[#EA5B25]'
                              : isCurrentCursor
                              ? 'border-[#EA5B25] text-[#262523]'
                              : userChar
                              ? 'border-[#262523] text-[#262523]'
                              : 'border-[#C5C1B5] text-[#B8B4A9]'
                          }`}
                        >
                          <span className="pb-1">{userChar || '_'}</span>
                        </span>
                      );
                    })}
                  </div>

                  {/* Bottom Status Row Inside Slot: Letter Counter & Tab/Enter Blind Keyboard Hint */}
                  <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-[#7A7873]">
                    <span>
                      已输 {typedLetterCount} / {totalLetterCount} 字母
                    </span>
                    <span>Tab 发音+提示 · Enter 核对</span>
                  </div>
                </div>

                {/* Feedback Banner Below Slot: Correct vs Wrong Comparison */}
                <div className="mt-3 min-h-[28px]">
                  {spellStatus === 'correct' && (
                    <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#2E7D5B]">
                      <Check className="h-3.5 w-3.5" />
                      <span>拼写正确！正在进入下一词...</span>
                    </div>
                  )}

                  {spellStatus === 'wrong' && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="inline-flex items-center gap-1.5 font-mono text-xs text-[#EA5B25]">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>
                          正确拼写：
                          <strong className="ml-1 font-serif text-sm tracking-wide text-[#262523] underline decoration-[#EA5B25] underline-offset-4">
                            {targetWord}
                          </strong>
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-[#7A7873]">
                        请对照正确拼写直接重敲订正（已标记为强化复习）
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* BOTTOM EXAMPLE SENTENCE (Cloze masked in Spelling Mode, full in Recognize Mode) */}
            <p className="mx-auto max-w-md font-serif text-sm italic leading-relaxed text-[#7A7873] line-clamp-3">
              “
              {studyMode === 'spell' && spellStatus !== 'correct'
                ? maskedSentence
                : activeCard.exampleSentence}
              ”
            </p>
          </div>

          {/* Two Physical Mechanical Buttons */}
          <div className="mt-6 flex w-full max-w-[540px] items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => handleDecision('unlearned')}
              className="skeuo-btn-light flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-medium"
            >
              <span>没记住</span>
              <kbd className="font-mono text-[11px] text-[#7A7873]">1</kbd>
            </button>

            <button
              type="button"
              onClick={() => handleDecision('mastered')}
              className="skeuo-btn-dark flex flex-1 items-center justify-between rounded-xl px-5 py-3.5 text-sm font-medium"
            >
              <span>记住了</span>
              <kbd className="font-mono text-[11px] text-[#7A7873]">2</kbd>
            </button>
          </div>
        </>
      )}

      {/* =====================================================================
          BOTTOM-RIGHT [ 📑 词表与添词 ] FLOATING SKEUOMORPHIC BUTTON
         ===================================================================== */}
      <div className="fixed bottom-5 right-5 z-30">
        <button
          type="button"
          onClick={() => {
            setAiFeedbackMsg(null);
            setIsDrawerOpen(true);
          }}
          className="skeuo-btn-light inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-[#262523] shadow-md"
        >
          <BookOpen className="h-3.5 w-3.5 text-[#EA5B25]" />
          <span>📑 词表与添词</span>
        </button>
      </div>

      {/* =====================================================================
          SLIDE-OVER DRAWER: AI SMART WORD INGESTION & WORD LIST MANAGEMENT
         ===================================================================== */}
      {isDrawerOpen && (
        <div
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-[#1E1D1B]/35 backdrop-blur-[1px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-[#D6D2C4] bg-[#F7F5F0] shadow-2xl"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-[#E2DEC9] bg-[#EFECE4] px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#EA5B25]" />
                <h2 className="font-serif text-base font-semibold text-[#262523]">
                  词表管理与 AI 智能添词
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#262523]"
                aria-label="关闭抽屉"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Section 1: AI Smart Word Ingestion (AI 智能添词) */}
            <div className="border-b border-[#E2DEC9] bg-[#FAF8F3] px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#262523]">
                  <Sparkles className="h-3.5 w-3.5 text-[#EA5B25]" />
                  <span>AI 智能添词（自动补齐音标 / 词性 / 雅思例句）</span>
                </span>
              </div>

              <textarea
                value={aiRawInput}
                onChange={(e) => setAiRawInput(e.target.value)}
                rows={2}
                placeholder="输入一个或多个英文单词/词组（逗号或换行分隔），例如：mitigate, ubiquitous, account for"
                className="w-full resize-none rounded-xl border border-[#D4D0C4] bg-[#F3F0E6] px-3.5 py-2.5 font-mono text-xs text-[#262523] placeholder-[#9B978E] shadow-inner focus:border-[#262523] focus:bg-[#FAF8F2] focus:outline-none"
              />

              <div className="mt-2.5 flex items-center justify-between gap-2">
                {/* Target Word-Box Selector */}
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#7A7873]">
                  <span>归入：</span>
                  <select
                    value={aiTargetCategory}
                    onChange={(e) =>
                      setAiTargetCategory(
                        e.target.value as 'writing' | 'task1' | 'task2'
                      )
                    }
                    className="rounded-lg border border-[#D6D2C4] bg-[#EFECE4] px-2 py-1 text-[11px] font-medium text-[#262523] focus:outline-none"
                  >
                    <option value="writing">✍️ 写作积累</option>
                    <option value="task1">📊 Task 1 核心词</option>
                    <option value="task2">💡 Task 2 学术词</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={isAiGenerating}
                  onClick={handleAiIngestWords}
                  className="skeuo-btn-dark inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium disabled:opacity-60"
                >
                  {isAiGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#EA5B25]" />
                      <span>AI 生成中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 text-[#EA5B25]" />
                      <span>AI 智能入库</span>
                    </>
                  )}
                </button>
              </div>

              {aiFeedbackMsg && (
                <div
                  className={`mt-2.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] ${
                    aiFeedbackMsg.type === 'success'
                      ? 'border-[#2E7D5B]/30 bg-[#EEF7F2] text-[#2E7D5B]'
                      : 'border-[#EA5B25]/35 bg-[#FDF2EE] text-[#EA5B25]'
                  }`}
                >
                  {aiFeedbackMsg.text}
                </div>
              )}
            </div>

            {/* Section 2: Word List Filter + Search + Delete */}
            <div className="flex flex-1 flex-col overflow-hidden px-5 pt-3.5 pb-4">
              {/* Category Pills inside Drawer */}
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {WORD_BOX_TABS.map((tab) => {
                  const isActive = selectedCategory === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(tab.id);
                        setCurrentIndex(0);
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition-all ${
                        isActive
                          ? 'skeuo-btn-light font-semibold text-[#262523]'
                          : 'bg-[#EBE8DF] text-[#7A7873] hover:text-[#262523]'
                      }`}
                    >
                      {tab.label} ({categoryCounts[tab.id]})
                    </button>
                  );
                })}
              </div>

              {/* Search input */}
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9B978E]" />
                <input
                  type="text"
                  value={drawerSearchQuery}
                  onChange={(e) => setDrawerSearchQuery(e.target.value)}
                  placeholder="搜索当前词盒中的英文或中文释义..."
                  className="w-full rounded-xl border border-[#D4D0C4] bg-[#F3F0E6] py-1.5 pl-8 pr-3 text-xs text-[#262523] placeholder-[#9B978E] focus:border-[#262523] focus:bg-[#FAF8F2] focus:outline-none"
                />
              </div>

              {/* Scrollable Word List */}
              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {drawerFilteredList.length === 0 ? (
                  <div className="flex h-40 flex-col items-center justify-center text-center font-mono text-xs text-[#7A7873]">
                    <span>当前筛选下暂无词条</span>
                  </div>
                ) : (
                  drawerFilteredList.map((item) => {
                    const itemPhonetic = getValidPhonetic(item);
                    const itemPos = getValidPos(item);
                    const isCurrentActive = activeCard?.id === item.id;

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          const idxInFiltered = filteredCards.findIndex(
                            (c) => c.id === item.id
                          );
                          if (idxInFiltered !== -1) {
                            setCurrentIndex(idxInFiltered);
                            setIsDrawerOpen(false);
                          }
                        }}
                        className={`group flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 transition-all ${
                          isCurrentActive
                            ? 'border-[#EA5B25]/50 bg-[#FAF5F0]'
                            : 'border-[#DFDBD0] bg-[#FAF8F4] hover:border-[#C5C0B2]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-serif text-sm font-semibold text-[#262523]">
                              {item.word}
                            </span>
                            {itemPos && (
                              <span className="font-mono text-[10px] font-semibold text-[#7A7873]">
                                {itemPos}
                              </span>
                            )}
                            {itemPhonetic && (
                              <span className="font-mono text-[10px] text-[#9B978E]">
                                {itemPhonetic}
                              </span>
                            )}
                            {item.status === 'mastered' && (
                              <span className="rounded bg-[#EEF7F2] px-1.5 py-0.5 font-mono text-[9px] text-[#2E7D5B]">
                                已掌握
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-[#7A7873]">
                            {item.chineseMeaning}
                          </p>
                        </div>

                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex shrink-0 items-center gap-1.5"
                        >
                          <button
                            type="button"
                            onClick={(e) => handleSpeak(item.word, e)}
                            className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                            title="发音 (en-GB)"
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onDeleteCard(item.id)}
                            className="skeuo-btn-light inline-flex h-7 items-center gap-1 rounded-lg px-2 font-mono text-[10px] text-[#7A7873] hover:text-[#EA5B25]"
                            title="从词库中删除该词"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
