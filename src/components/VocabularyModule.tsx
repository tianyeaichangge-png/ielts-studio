import React, { useState, useEffect, useCallback } from 'react';
import { Volume2 } from 'lucide-react';
import { MasteryStatus, VocabularyCard } from '../types/ielts';

interface VocabularyModuleProps {
  cards: VocabularyCard[];
  onUpdateStatus: (id: string, status: MasteryStatus) => void;
}

export const VocabularyModule: React.FC<VocabularyModuleProps> = ({
  cards,
  onUpdateStatus,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const total = cards.length;
  const safeIndex = total > 0 ? currentIndex % total : 0;
  const activeCard = cards[safeIndex] || null;

  const formattedIndex = String(safeIndex + 1).padStart(2, '0');
  const formattedTotal = String(total).padStart(2, '0');

  const handleSpeak = useCallback((text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 0.92;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const handleDecision = useCallback(
    (status: MasteryStatus) => {
      if (!activeCard) return;
      onUpdateStatus(activeCard.id, status);
      setIsFlipped(false);
      setCurrentIndex((prev) => (prev + 1) % total);
    },
    [activeCard, onUpdateStatus, total]
  );

  // Keyboard shortcuts: Space to flip, 1 for 没记住, 2 for 记住了
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped((prev) => !prev);
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
  }, [handleDecision]);

  if (!activeCard) return null;

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center px-4 pb-10 select-none">
      {/* Tiny Braun Mechanical Counter */}
      <div className="mb-5 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#EA5B25]" />
        <span className="font-mono text-xs font-medium tracking-[0.22em] text-[#7A7873]">
          {formattedIndex} / {formattedTotal}
        </span>
      </div>

      {/* Single Thick-Paper Tactile Card (Fixed Width & Height) */}
      <div
        onClick={() => setIsFlipped((prev) => !prev)}
        className="perspective-1000 relative h-[360px] w-full max-w-[520px] cursor-pointer"
      >
        <div
          className={`transform-style-3d relative h-full w-full transition-transform duration-500 ease-out ${
            isFlipped ? 'rotate-y-180' : ''
          }`}
        >
          {/* FRONT: Serif Word + Phonetic + Speaker Icon + Quoted Exam Sentence */}
          <div className="backface-hidden skeuo-paper absolute inset-0 flex flex-col items-center justify-between rounded-2xl px-10 py-10 text-center">
            <div className="w-full flex items-center justify-between text-[11px] font-mono tracking-wider text-[#7A7873]">
              <span>{activeCard.partOfSpeech}</span>
              {activeCard.status === 'mastered' && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#262523]" />
              )}
            </div>

            <div className="my-auto flex flex-col items-center">
              <h1 className="font-serif text-5xl font-normal tracking-tight text-[#262523]">
                {activeCard.word}
              </h1>

              <div className="mt-3.5 inline-flex items-center gap-2 text-[#7A7873]">
                <span className="font-mono text-sm">{activeCard.phonetic}</span>
                <button
                  type="button"
                  onClick={(e) => handleSpeak(activeCard.word, e)}
                  className="skeuo-btn-light flex h-6 w-6 items-center justify-center rounded-md text-[#7A7873] hover:text-[#EA5B25]"
                  title="朗读发音"
                  aria-label="朗读发音"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <p className="max-w-md font-serif text-sm italic leading-relaxed text-[#7A7873]">
              “{activeCard.exampleSentence}”
            </p>
          </div>

          {/* BACK: Chinese Meaning + Fine-line Paraphrasing Box */}
          <div className="backface-hidden rotate-y-180 skeuo-paper absolute inset-0 flex flex-col items-center justify-between rounded-2xl px-10 py-10 text-center">
            <div className="w-full flex items-center justify-between border-b border-[#E2DFD5] pb-3">
              <span className="font-serif text-lg text-[#262523]">
                {activeCard.word}
              </span>
              <span className="font-mono text-xs text-[#7A7873]">
                {activeCard.phonetic}
              </span>
            </div>

            <div className="my-auto w-full space-y-6">
              <div>
                <p className="text-xl font-medium tracking-tight text-[#262523]">
                  {activeCard.chineseMeaning}
                </p>
                <p className="mt-1.5 font-serif text-xs text-[#7A7873]">
                  {activeCard.englishDefinition}
                </p>
              </div>

              {/* Fine-line framed Paraphrasing Box */}
              <div className="mx-auto max-w-md rounded-xl border border-[#D5D1C6] bg-[#F4F1EA]/70 px-5 py-3.5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#7A7873]">
                  同义替换词 · Paraphrasing
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
                  {activeCard.paraphrasing.map((syn, idx) => (
                    <span
                      key={idx}
                      className="font-serif text-sm text-[#262523]"
                    >
                      {syn}
                      {idx < activeCard.paraphrasing.length - 1 && (
                        <span className="ml-3 text-[#C5C1B5]">/</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-xs text-[#7A7873]">
              {activeCard.exampleTranslation}
            </p>
          </div>
        </div>
      </div>

      {/* Two Physical Mechanical Buttons Only */}
      <div className="mt-7 flex w-full max-w-[520px] items-center justify-center gap-4">
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
