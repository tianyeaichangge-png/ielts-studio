import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

export interface SelectionHighlightPopoverProps {
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

interface BoundingRectSnapshot {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface PopoverSnapshotData {
  selectedText: string;
  containerId: string;
  rect: BoundingRectSnapshot;
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

const preventSelectionLossOnMouseDown = (
  e: React.MouseEvent<HTMLElement>
) => {
  e.preventDefault();
  e.stopPropagation();
};

// Clamp X & Y so the floating pill stays 8px above selection and never overflows viewport edges
function computeClampedCoords(rect: BoundingRectSnapshot): {
  x: number;
  y: number;
} {
  const rawX = rect.left + rect.width / 2;
  const clampedX = Math.max(155, Math.min(window.innerWidth - 155, rawX));
  const rawY = rect.top - 8;
  const clampedY = Math.max(48, rawY);
  return { x: clampedX, y: clampedY };
}

function snapshotDomRect(domRect: DOMRect): BoundingRectSnapshot {
  return {
    top: domRect.top,
    left: domRect.left,
    right: domRect.right,
    bottom: domRect.bottom,
    width: domRect.width,
    height: domRect.height,
  };
}

export const SelectionHighlightPopover: React.FC<
  SelectionHighlightPopoverProps
> = React.memo(
  ({
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
    const [popoverData, setPopoverData] =
      useState<PopoverSnapshotData | null>(null);
    const [vocabStatus, setVocabStatus] = useState<
      'idle' | 'loading' | 'saved'
    >('idle');
    const [excerptSaved, setExcerptSaved] = useState(false);

    const popoverRef = useRef<HTMLDivElement | null>(null);
    const mouseUpTimerRef = useRef<number | null>(null);

    // Keep latest callbacks in a ref so document event listeners never need to re-bind on parent re-renders
    const latestPropsRef = useRef({
      aiConfig,
      sourceLabel,
      isTextHighlighted,
      onApplyHighlight,
      onEraseHighlight,
      onIngestVocab,
      onExcerptToNotes,
      onOpenApiKeyModal,
    });
    latestPropsRef.current = {
      aiConfig,
      sourceLabel,
      isTextHighlighted,
      onApplyHighlight,
      onEraseHighlight,
      onIngestVocab,
      onExcerptToNotes,
      onOpenApiKeyModal,
    };

    const closePopover = useCallback(() => {
      if (mouseUpTimerRef.current !== null) {
        window.clearTimeout(mouseUpTimerRef.current);
        mouseUpTimerRef.current = null;
      }
      setPopoverData(null);
      setVocabStatus('idle');
      setExcerptSaved(false);
    }, []);

    useEffect(() => {
      // 1. ONLY close popover on global `mousedown` when clicking outside popoverRef
      //    Strictly NO `click` or `selectionchange` close listeners!
      const handleGlobalMouseDown = (e: MouseEvent) => {
        if (
          popoverRef.current &&
          popoverRef.current.contains(e.target as Node)
        ) {
          return;
        }
        if (mouseUpTimerRef.current !== null) {
          window.clearTimeout(mouseUpTimerRef.current);
          mouseUpTimerRef.current = null;
        }
        setPopoverData(null);
        setVocabStatus('idle');
        setExcerptSaved(false);
      };

      // 2. On `mouseup`, delay 20ms before reading `window.getSelection()` so browser selection is 100% stable
      const handleGlobalMouseUp = (e: MouseEvent) => {
        if (
          popoverRef.current &&
          popoverRef.current.contains(e.target as Node)
        ) {
          return;
        }

        const targetNode = e.target as Node | null;
        const clientX = e.clientX;
        const clientY = e.clientY;

        if (mouseUpTimerRef.current !== null) {
          window.clearTimeout(mouseUpTimerRef.current);
        }

        mouseUpTimerRef.current = window.setTimeout(() => {
          mouseUpTimerRef.current = null;
          const container = containerRef.current;
          if (!container) return;

          const {
            sourceLabel: currentSourceLabel,
            isTextHighlighted: checkHighlighted,
          } = latestPropsRef.current;

          const targetEl =
            targetNode && targetNode.nodeType === Node.ELEMENT_NODE
              ? (targetNode as HTMLElement)
              : targetNode?.parentElement ?? null;

          // Case A: User selected text inside a <textarea> within container (e.g. Notes Edit mode)
          const activeEl = document.activeElement;
          const textareaEl =
            targetEl instanceof HTMLTextAreaElement &&
            container.contains(targetEl)
              ? targetEl
              : activeEl instanceof HTMLTextAreaElement &&
                container.contains(activeEl)
              ? activeEl
              : null;

          if (textareaEl) {
            const start = textareaEl.selectionStart ?? 0;
            const end = textareaEl.selectionEnd ?? 0;
            const rawSlice = textareaEl.value.slice(start, end).trim();
            if (rawSlice.length > 1) {
              const cleanSlice = rawSlice
                .replace(/^==(?:[og]:)?/i, '')
                .replace(/==$/, '')
                .trim();
              if (cleanSlice.length > 0) {
                const alreadyHl =
                  /^==(?:[og]:)?[\s\S]+==$/.test(rawSlice) ||
                  Boolean(checkHighlighted?.(cleanSlice));
                const taRect = textareaEl.getBoundingClientRect();
                const syntheticRect: BoundingRectSnapshot = {
                  top: Math.max(taRect.top, clientY - 14),
                  left: clientX - 20,
                  right: clientX + 20,
                  bottom: clientY,
                  width: 40,
                  height: 14,
                };
                const { x, y } = computeClampedCoords(syntheticRect);
                setVocabStatus('idle');
                setExcerptSaved(false);
                setPopoverData({
                  selectedText: cleanSlice,
                  containerId: currentSourceLabel,
                  rect: syntheticRect,
                  x,
                  y,
                  isAlreadyHighlighted: alreadyHl,
                  textareaSelection: {
                    textarea: textareaEl,
                    start,
                    end,
                  },
                });
                return;
              }
            }
          }

          // Case B: Standard DOM Selection via window.getSelection()
          const selection = window.getSelection();
          const selectedStr = selection ? selection.toString().trim() : '';

          if (
            selection &&
            !selection.isCollapsed &&
            selectedStr.length > 1 &&
            selection.rangeCount > 0
          ) {
            const range = selection.getRangeAt(0);
            const commonNode = range.commonAncestorContainer;
            const hostEl =
              commonNode.nodeType === Node.ELEMENT_NODE
                ? (commonNode as HTMLElement)
                : commonNode.parentElement;

            // Ignore single-line <input> selections (e.g. search bar or note title input)
            if (
              hostEl?.tagName === 'INPUT' ||
              targetEl?.tagName === 'INPUT'
            ) {
              return;
            }

            const anchorInside =
              Boolean(selection.anchorNode) &&
              container.contains(selection.anchorNode);
            const focusInside =
              Boolean(selection.focusNode) &&
              container.contains(selection.focusNode);
            const commonInside =
              Boolean(hostEl) && container.contains(hostEl as Node);

            if (anchorInside || focusInside || commonInside) {
              const rawRect = range.getBoundingClientRect();
              const firstClientRect =
                rawRect.width === 0 &&
                rawRect.height === 0 &&
                range.getClientRects().length > 0
                  ? range.getClientRects()[0]
                  : rawRect;

              const rectSnapshot: BoundingRectSnapshot =
                firstClientRect.width > 0 || firstClientRect.height > 0
                  ? snapshotDomRect(firstClientRect)
                  : {
                      top: clientY - 16,
                      left: clientX - 16,
                      right: clientX + 16,
                      bottom: clientY,
                      width: 32,
                      height: 16,
                    };

              const { x, y } = computeClampedCoords(rectSnapshot);
              const enclosingMark = (hostEl?.closest?.(
                'mark[data-highlight-text]'
              ) ||
                targetEl?.closest?.(
                  'mark[data-highlight-text]'
                )) as HTMLElement | null;

              const cleanText = selectedStr
                .replace(/^==(?:[og]:)?/i, '')
                .replace(/==$/, '')
                .trim();

              if (cleanText.length > 0) {
                const alreadyHl =
                  Boolean(enclosingMark) ||
                  Boolean(checkHighlighted?.(cleanText));

                setVocabStatus('idle');
                setExcerptSaved(false);
                setPopoverData({
                  selectedText: cleanText,
                  containerId: currentSourceLabel,
                  rect: rectSnapshot,
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

          // Case C: User clicked directly on an existing <mark data-highlight-text="..."> element to erase or recolor
          const markEl = targetEl?.closest?.(
            'mark[data-highlight-text]'
          ) as HTMLElement | null;
          if (markEl && container.contains(markEl)) {
            const hlText = (
              markEl.getAttribute('data-highlight-text') ||
              markEl.textContent ||
              ''
            ).trim();
            const hlColor = (markEl.getAttribute('data-highlight-color') ||
              'yellow') as HighlightMarkerColor;
            if (hlText.length > 0) {
              const rectSnapshot = snapshotDomRect(
                markEl.getBoundingClientRect()
              );
              const { x, y } = computeClampedCoords(rectSnapshot);
              setVocabStatus('idle');
              setExcerptSaved(false);
              setPopoverData({
                selectedText: hlText,
                containerId: currentSourceLabel,
                rect: rectSnapshot,
                x,
                y,
                isAlreadyHighlighted: true,
                activeColor: hlColor,
              });
            }
          }
        }, 20);
      };

      document.addEventListener('mousedown', handleGlobalMouseDown);
      document.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        if (mouseUpTimerRef.current !== null) {
          window.clearTimeout(mouseUpTimerRef.current);
          mouseUpTimerRef.current = null;
        }
        document.removeEventListener('mousedown', handleGlobalMouseDown);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }, [containerRef]);

    if (!popoverData || typeof document === 'undefined') return null;

    const handleSelectMarkerColor = (color: HighlightMarkerColor) => {
      latestPropsRef.current.onApplyHighlight(
        popoverData.selectedText,
        color,
        popoverData.textareaSelection
      );
      window.getSelection()?.removeAllRanges();
      closePopover();
    };

    const handleErase = () => {
      latestPropsRef.current.onEraseHighlight(
        popoverData.selectedText,
        popoverData.textareaSelection
      );
      window.getSelection()?.removeAllRanges();
      closePopover();
    };

    const handleSaveVocab = async () => {
      if (vocabStatus !== 'idle') return;
      const {
        aiConfig: currentAiConfig,
        sourceLabel: currentSourceLabel,
        onIngestVocab: ingestVocab,
        onOpenApiKeyModal: openModal,
      } = latestPropsRef.current;

      if (!currentAiConfig.apiKey.trim()) {
        openModal?.();
        return;
      }

      const cachedText = popoverData.selectedText.trim();
      if (!cachedText) return;

      setVocabStatus('loading');
      try {
        const cardData = await completeSelectedVocabWithDeepSeek({
          selectedText: cachedText,
          apiKey: currentAiConfig.apiKey,
          endpoint: currentAiConfig.endpoint,
        });
        ingestVocab(cardData);
        setVocabStatus('saved');
        window.setTimeout(() => {
          closePopover();
        }, 500);
      } catch {
        ingestVocab({
          word: cachedText,
          phonetic: '',
          partOfSpeech: cachedText.includes(' ') ? 'phrase' : 'n.',
          meaning: '划词积累表达',
          chineseMeaning: '划词积累表达',
          fullMeaning: '划词积累高分表达',
          englishDefinition: cachedText,
          paraphrasing: [],
          synonyms: [],
          exampleSentence: cachedText,
          exampleTranslation: '',
          topicTag: currentSourceLabel,
          isCustom: true,
          fromWriting: true,
          vocabCategory: 'writing',
        });
        setVocabStatus('saved');
        window.setTimeout(() => {
          closePopover();
        }, 500);
      }
    };

    const handleExcerpt = () => {
      const {
        sourceLabel: currentSourceLabel,
        onExcerptToNotes: excerptToNotes,
      } = latestPropsRef.current;
      if (excerptSaved || !excerptToNotes) return;

      const clean = popoverData.selectedText.trim();
      if (!clean) return;

      const key = `sel-excerpt:${currentSourceLabel}:${clean.slice(0, 48)}`;
      const mdBlock = [
        `## 【划词摘录】${currentSourceLabel}`,
        `> ${clean}`,
      ].join('\n');

      excerptToNotes({
        sourceKey: key,
        markdownBlock: mdBlock,
      });
      setExcerptSaved(true);
      window.setTimeout(() => {
        closePopover();
      }, 450);
    };

    const popoverElement = (
      <div
        ref={popoverRef}
        onMouseDown={preventSelectionLossOnMouseDown}
        style={{
          position: 'fixed',
          left: `${popoverData.x}px`,
          top: `${popoverData.y}px`,
          transform: 'translate(-50%, -100%)',
        }}
        className="z-50 flex items-center gap-2.5 rounded-full border border-[#DCD6CC] bg-[#FAF8F5] px-3 py-1.5 shadow-md select-none"
      >
        {/* Left: 3 Warm Paper Marker Swatch Dots */}
        <div
          onMouseDown={preventSelectionLossOnMouseDown}
          className="flex items-center gap-2"
        >
          {HIGHLIGHT_MARKER_SWATCHES.map((swatch) => {
            const isCurrent =
              popoverData.isAlreadyHighlighted &&
              popoverData.activeColor === swatch.color;
            return (
              <button
                key={swatch.color}
                type="button"
                onMouseDown={preventSelectionLossOnMouseDown}
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
        {popoverData.isAlreadyHighlighted && (
          <>
            <span className="h-3.5 w-[1px] bg-[#E2DDD3]" aria-hidden="true" />
            <button
              type="button"
              onMouseDown={preventSelectionLossOnMouseDown}
              onClick={handleErase}
              className="whitespace-nowrap font-sans text-xs font-medium text-[#7A7873] transition-colors hover:text-[#EA5B25]"
            >
              [ × 擦除 ]
            </button>
          </>
        )}

        {/* Right: Quick Linkage Actions ([ + 存词 ] & [ + 摘录 ]) */}
        <span className="h-3.5 w-[1px] bg-[#E2DDD3]" aria-hidden="true" />

        <div
          onMouseDown={preventSelectionLossOnMouseDown}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            disabled={vocabStatus !== 'idle'}
            onMouseDown={preventSelectionLossOnMouseDown}
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
              onMouseDown={preventSelectionLossOnMouseDown}
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

    // 4. Mount popover via React Portal to document.body so its state updates stay 100% isolated from text containers
    return createPortal(popoverElement, document.body);
  }
);
