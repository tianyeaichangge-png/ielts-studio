import { useLayoutEffect, type RefObject } from 'react';

export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement>, value: string | undefined) {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea || value === undefined) return;

    const fitHeight = () => {
      textarea.style.height = 'auto';
      const borderHeight = textarea.offsetHeight - textarea.clientHeight;
      textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
    };

    fitHeight();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      // Wrapping changes when the pane resizes. Ignore our own height updates.
      if (width === textarea.clientWidth) return;
      width = textarea.clientWidth;
      fitHeight();
    });
    observer.observe(textarea);
    document.fonts?.addEventListener('loadingdone', fitHeight);

    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', fitHeight);
    };
  }, [ref, value]);
}
