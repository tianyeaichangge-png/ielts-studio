import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import {
  DeepSeekConfig,
  HighlightMarkerColor,
  VocabularyCard,
} from '../types/ielts';
import {
  completeSelectedVocabWithDeepSeek,
  HIGHLIGHT_MARKER_SWATCHES,
} from '../lib/textHighlightUtils';

interface SelectionHighlightPopoverProps {
  containerRef: React.RefObject<HTMLElement | null>;
  aiConfig: DeepSeekConfig;
  sourceLabel: string;
  isTextHighlighted?: (text: string) => boolean;
  onApplyHighlight: (
    text: string,
    color: HighlightMarkerColor,
    textareaSelection?: {
      textarea: HTMLTextAreaElement;
      start: number;
      end: number;
    }
  ) => void;
  onEraseHighlight: (
    text: string,
    textareaSelection?: {
      textarea: HTMLTextAreaElement;
      start: number;
      end: number;
    }
  ) => void;
  onIngestVocab: (
    newCard: Omit<VocabularyCard, 'id' | 'reviewCount' | 'status'>
  ) => void;
  onExcerptToNotes?: (payload: {
    sourceKey: string;
    markdownBlock: string;
  }) => void;
  onOpenApiKeyModal?: () => void;
}

interface PopoverState {
  text: string;
  x: number;
  y: number;
  isAlreadyHighlighted: boolean;
  activeColor?: HighlightMarkerColor;
  textareaSelection?: {
    textarea: HTMLTextAreaElement;
    start: number;
    end: number;
  };
}

export const SelectionHighlightPopover: React.FC<
  SelectionHighlightPopoverProps
> = ({
  containerRef,
  aiConfig,
  sourceLabel,
  isTextHighlighted,
  onApplyHighlight,
  onEraseHighlight,
  onIngestVocab,
  onExcerptToNotes,
  onOpenApiKeyModal,
}) => {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [vocabStatus, setVocabStatus] = useState<'idle' | 'loading' | 'saved'>(
    'idle'
  );
  const [excerptSaved, setExcerptSaved] = useState(false);

  const popoverRef = useRef<HTMLDivElement | null>(null);

  const closePopover = useCallback(() => {
    setPopover(null);
    setVocabStatus('idle');
    setExcerptSaved(false);
  }, []);

  // Clamp X & Y so the floating pill stays 8px above selection and never overflows viewport edges
  const computeClampedCoords = (rect: DOMRect): { x: number; y: number } => {
    const rawX = rect.left + rect.width / 2;
    const clampedX = Math.max(150, Math.min(window.innerWidth - 150, rawX));
    const rawY = rect.top - 8;
    const clampedY = Math.max(48, rawY);
    return { x: clampedX, y: clampedY };
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      // Ignore clicks inside the popover itself
      if (
        popoverRef.current &&
        popoverRef.current.contains(e.target as Node)
      ) {
        return;
      }

      const targetEl = e.target as HTMLElement | null;

      // Case 1: User clicked directly on an existing <mark data-highlight-text="..."> element
      const markEl = targetEl?.closest?.('mark[data-highlight-text]') as
        | HTMLElement
        | null;
      const domSelection = window.getSelection();
      const selectedStr = domSelection ? domSelection.toString().trim() : '';

      if (markEl && container.contains(markEl) && selectedStr.length <= 1) {
        const hlText =
          markEl.getAttribute('data-highlight-text') ||
          markEl.textContent?.trim() ||
          '';
        const hlColor = (markEl.getAttribute('data-highlight-color') ||
          'yellow') as HighlightMarkerColor;
        if (hlText.length > 1) {
          const rect = markEl.getBoundingClientRect();
          const { x, y } = computeClampedCoords(rect);
          setVocabStatus('idle');
          setExcerptSaved(false);
          setPopover({
            text: hlText,
            x,
            y,
            isAlreadyHighlighted: true,
            activeColor: hlColor,
          });
          return;
        }
      }

      // Case 2: User selected text inside a <textarea> within container (e.g. Notes Edit mode)
      if (
        targetEl instanceof HTMLTextAreaElement &&
        container.contains(targetEl)
      ) {
        const start = targetEl.selectionStart ?? 0;
        const end = targetEl.selectionEnd ?? 0;
        const rawSlice = targetEl.value.slice(start, end).trim();
        if (rawSlice.length > 1) {
          const cleanSlice = rawSlice
            .replace(/^==(?:[og]:)?/i, '')
            .replace(/==$/, '')
            .trim();
          const alreadyHl =
            /^==(?:[og]:)?[\s\S]+==$/.test(rawSlice) ||
            Boolean(isTextHighlighted?.(cleanSlice));
          const taRect = targetEl.getBoundingClientRect();
          const x = Math.max(
            150,
            Math.min(window.innerWidth - 150, e.clientX)
          );
          const y = Math.max(52, Math.max(taRect.top, e.clientY - 18));
          setVocabStatus('idle');
          setExcerptSaved(false);
          setPopover({
            text: cleanSlice,
            x,
            y,
            isAlreadyHighlighted: alreadyHl,
            textareaSelection: {
              textarea: targetEl,
              start,
              end,
            },
          });
          return;
        }
      }

      // Case 3: Standard DOM text selection inside container
      if (
        domSelection &&
        !domSelection.isCollapsed &&
        selectedStr.length > 1 &&
        domSelection.rangeCount > 0
      ) {
        const range = domSelection.getRangeAt(0);
        const commonNode = range.commonAncestorContainer;
        const hostEl =
          commonNode.nodeType === Node.ELEMENT_NODE
            ? (commonNode as HTMLElement)
            : commonNode.parentElement;

        // Do not trigger inside normal single-line inputs
        if (hostEl?.tagName === 'INPUT') {
          return;
        }

        if (hostEl && container.contains(hostEl)) {
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            const { x, y } = computeClampedCoords(rect);
            const enclosingMark = hostEl.closest?.(
              'mark[data-highlight-text]'
            ) as HTMLElement | null;
            const cleanText = selectedStr
              .replace(/^==(?:[og]:)?/i, '')
              .replace(/==$/, '')
              .trim();
            const alreadyHl =
              Boolean(enclosingMark) ||
              Boolean(isTextHighlighted?.(cleanText));

            setVocabStatus('idle');
            setExcerptSaved(false);
            setPopover({
              text: cleanText,
              x,
              y,
              isAlreadyHighlighted: alreadyHl,
              activeColor: (enclosingMark?.getAttribute(
                'data-highlight-color'
              ) || undefined) as HighlightMarkerColor | undefined,
            });
            return;
          }
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        popoverRef.current.contains(e.target as Node)
      ) {
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest?.('mark[data-highlight-text]')) {
        return;
      }
      setPopover(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePopover();
      }
    };

    const handleScroll = () => {
      setPopover((prev) => (prev ? null : prev));
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [containerRef, isTextHighlighted, closePopover]);

  if (!popover) return null;

  const handleSelectMarkerColor = (color: HighlightMarkerColor) => {
    onApplyHighlight(popover.text, color, popover.textareaSelection);
    window.getSelection()?.removeAllRanges();
    setPopover((prev) =>
      prev
        ? {
            ...prev,
            isAlreadyHighlighted: true,
            activeColor: color,
          }
        : null
    );
    setTimeout(() => {
      closePopover();
    }, 120);
  };

  const handleErase = () => {
    onEraseHighlight(popover.text, popover.textareaSelection);
    window.getSelection()?.removeAllRanges();
    closePopover();
  };

  const handleSaveVocab = async () => {
    if (vocabStatus !== 'idle') return;
    if (!aiConfig.apiKey.trim()) {
      onOpenApiKeyModal?.();
      return;
    }

    setVocabStatus('loading');
    try {
      const cardData = await completeSelectedVocabWithDeepSeek({
        selectedText: popover.text,
        apiKey: aiConfig.apiKey,
        endpoint: aiConfig.endpoint,
      });
      onIngestVocab(cardData);
      setVocabStatus('saved');
      setTimeout(() => {
        closePopover();
      }, 650);
    } catch {
      // Fallback immediate ingestion if API fails
      const clean = popover.text.trim();
      onIngestVocab({
        word: clean,
        phonetic: '',
        partOfSpeech: clean.includes(' ') ? 'phrase' : 'n.',
        meaning: '划词积累表达',
        chineseMeaning: '划词积累表达',
        fullMeaning: '划词积累高分表达',
        englishDefinition: clean,
        paraphrasing: [],
        synonyms: [],
        exampleSentence: clean,
        exampleTranslation: '',
        topicTag: sourceLabel,
        isCustom: true,
        fromWriting: true,
        vocabCategory: 'writing',
      });
      setVocabStatus('saved');
      setTimeout(() => {
        closePopover();
      }, 650);
    }
  };

  const handleExcerpt = () => {
    if (excerptSaved || !onExcerptToNotes) return;
    const clean = popover.text.trim();
    const key = `sel-excerpt:${sourceLabel}:${clean.slice(0, 48)}`;
    const mdBlock = [
      `## 【划词摘录】${sourceLabel}`,
      `> ${clean}`,
    ].join('\n');

    onExcerptToNotes({
      sourceKey: key,
      markdownBlock: mdBlock,
    });
    setExcerptSaved(true);
    setTimeout(() => {
      closePopover();
    }, 550);
  };

  return (
    <div
      ref={popoverRef}
      onMouseDown={(e) => {
        // Prevent losing selection when clicking inside the popover
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'fixed',
        left: `${popover.x}px`,
        top: `${popover.y}px`,
        transform: 'translate(-50%, -100%)',
      }}
      className="z-50 flex items-center gap-2.5 rounded-full border border-[#DCD6CC] bg-[#FAF8F5] px-3 py-1.5 shadow-md select-none"
    >
      {/* Left: 3 Warm Paper Marker Swatch Dots */}
      <div className="flex items-center gap-2">
        {HIGHLIGHT_MARKER_SWATCHES.map((swatch) => {
          const isCurrent =
            popover.isAlreadyHighlighted &&
            popover.activeColor === swatch.color;
          return (
            <button
              key={swatch.color}
              type="button"
              onClick={() => handleSelectMarkerColor(swatch.color)}
              title={swatch.label}
              aria-label={swatch.label}
              style={{ backgroundColor: swatch.dotColor }}
              className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                isCurrent
                  ? 'border-[#2C2A29] ring-1 ring-[#2C2A29]/40 scale-110'
                  : 'border-black/15'
              }`}
            />
          );
        })}
      </div>

      {/* Middle: [ × 擦除 ] Button (Shown when selection or clicked span is already highlighted) */}
      {popover.isAlreadyHighlighted && (
        <>
          <span className="h-3.5 w-[1px] bg-[#E2DDD3]" aria-hidden="true" />
          <button
            type="button"
            onClick={handleErase}
            className="whitespace-nowrap font-sans text-xs font-medium text-[#7A7873] transition-colors hover:text-[#EA5B25]"
          >
            [ × 擦除 ]
          </button>
        </>
      )}

      {/* Right: Quick Linkage Actions ([ + 存词 ] & [ + 摘录 ]) */}
      <span className="h-3.5 w-[1px] bg-[#E2DDD3]" aria-hidden="true" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={vocabStatus !== 'idle'}
          onClick={handleSaveVocab}
          className="inline-flex items-center gap-1 whitespace-nowrap font-sans text-xs font-medium text-[#5C5852] transition-colors hover:text-[#EA5B25] disabled:text-[#8C867E]"
          title="调用 deepseek-v4-flash 补全释义并存入「写作积累」词盒"
        >
          {vocabStatus === 'loading' ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-[#EA5B25]" />
              <span>存词中</span>
            </>
          ) : vocabStatus === 'saved' ? (
            <span className="text-[#2E7D5B]">✓ 已存词</span>
          ) : (
            <span>[ + 存词 ]</span>
          )}
        </button>

        {onExcerptToNotes && (
          <button
            type="button"
            disabled={excerptSaved}
            onClick={handleExcerpt}
            className="whitespace-nowrap font-sans text-xs font-medium text-[#5C5852] transition-colors hover:text-[#EA5B25] disabled:text-[#2E7D5B]"
            title="将选中文本直接追加摘录至【笔记】模块的「摘录复盘」"
          >
            {excerptSaved ? '✓ 已摘录' : '[ + 摘录 ]'}
          </button>
        )}
      </div>
    </div>
  );
};
