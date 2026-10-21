import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Volume2, Check, AlertCircle, Eye, Keyboard } from 'lucide-react';
import { MasteryStatus, VocabularyCard } from '../types/ielts';

interface VocabularyModuleProps {
  cards: VocabularyCard[];
  onUpdateStatus: (id: string, status: MasteryStatus) => void;
}

type StudyMode = 'recognize' | 'spell';
type SpellCheckStatus = 'idle' | 'correct' | 'wrong';

const FALLBACK_PHONETIC_DICT: Record<string, { phonetic: string; pos: string }> = {
  categories: { phonetic: '/ˈkætəɡəriz/', pos: 'n.' },
  category: { phonetic: '/ˈkætəɡəri/', pos: 'n.' },
  proportion: { phonetic: '/prəˈpɔːʃn/', pos: 'n.' },
  significantly: { phonetic: '/sɪɡˈnɪfɪkəntli/', pos: 'adv.' },
  dramatically: { phonetic: '/drəˈmætɪkli/', pos: 'adv.' },
};

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
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
}) => {
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

  const spellInputRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  const total = cards.length;
  const safeIndex = total > 0 ? currentIndex % total : 0;
  const activeCard = cards[safeIndex] || null;

  const formattedIndex = String(safeIndex + 1).padStart(2, '0');
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

  // Reset card-specific states when switching card or switching mode
  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setIsMeaningRevealed(false);
    setTypedInput('');
    setSpellStatus('idle');
    setHasRecordedMistakeThisCard(false);

    if (studyMode === 'spell' && activeCard) {
      // Auto-pronounce when entering Spelling Mode or advancing to next card in Spelling Mode
      const speakTimer = window.setTimeout(() => {
        handleSpeak(activeCard.word);
        spellInputRef.current?.focus();
      }, 80);
      return () => window.clearTimeout(speakTimer);
    }
  }, [safeIndex, studyMode, activeCard?.id, activeCard?.word, handleSpeak]);

  const handleDecision = useCallback(
    (status: MasteryStatus) => {
      if (!activeCard) return;
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
    if (!activeCard) return;

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

  // Global keyboard shortcuts in Recognize Mode: Space to reveal/hide meaning, 1 for 没记住, 2 for 记住了
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (studyMode === 'spell') {
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
  }, [studyMode, handleDecision]);

  if (!activeCard) return null;

  const targetWord = activeCard.word.trim();
  const isLongPhrase = targetWord.length > 16;
  const isMultiWord = targetWord.includes(' ');
  const maskedSentence = maskTargetWordInSentence(
    activeCard.exampleSentence,
    targetWord
  );

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
    <div className="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center px-4 pb-10 select-none">
      {/* Tiny Braun Mechanical Counter */}
      <div className="mb-5 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
        <span className="font-mono text-xs font-medium tracking-[0.22em] text-[#7A7873]">
          {formattedIndex} / {formattedTotal}
        </span>
      </div>

      {/* Single Thick-Paper Tactile Card */}
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
              MODE 2: SPELLING MODE (键盘拼写默写模式)
             ===================================================================== */
          <div
            onClick={(e) => {
              e.stopPropagation();
              spellInputRef.current?.focus();
            }}
            className="my-auto flex w-full flex-col items-center py-3"
          >
            {/* Clue Header: Chinese Meaning + POS + Audio Replay Button */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="inline-flex items-center gap-2">
                {validPos && (
                  <span className="rounded border border-[#D8D4C8] bg-[#EFECE4] px-2 py-0.5 font-mono text-xs font-semibold text-[#7A7873]">
                    {validPos}
                  </span>
                )}
                <span className="text-lg font-semibold tracking-tight text-[#262523]">
                  {activeCard.chineseMeaning}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleSpeak(activeCard.word, e)}
                  className="skeuo-btn-light flex h-7 w-7 items-center justify-center rounded-lg text-[#7A7873] hover:text-[#EA5B25]"
                  title="重播单词发音 (en-GB)"
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
                      <span className="pb-1">
                        {userChar || '_'}
                      </span>
                    </span>
                  );
                })}
              </div>

              {/* Bottom Status Row Inside Slot: Letter Counter & Enter Hint */}
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-[#7A7873]">
                <span>
                  已输 {typedLetterCount} / {totalLetterCount} 字母
                </span>
                <span>按 Enter 核对</span>
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
      <div className="mt-7 flex w-full max-w-[540px] items-center justify-center gap-4">
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
    </div>
  );
};
