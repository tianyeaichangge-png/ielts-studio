import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';

const MIN = 40;
const DEFAULT = 50;
const MAX = 60;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

interface WritingWorkspaceProps {
  resizable: boolean;
  children: [reference: ReactElement, manuscript: ReactElement];
}

export function WritingWorkspace({ resizable, children: [reference, manuscript] }: WritingWorkspaceProps) {
  const [leftPercent, setLeftPercent] = useState(DEFAULT);
  const workspace = useRef<HTMLElement>(null);
  const grabOffset = useRef(0);

  function adjustWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowLeft': setLeftPercent(value => clamp(value - 1)); break;
      case 'ArrowRight': setLeftPercent(value => clamp(value + 1)); break;
      case 'Home': setLeftPercent(MIN); break;
      case 'End': setLeftPercent(MAX); break;
      case 'Enter': setLeftPercent(DEFAULT); break;
      default: return;
    }
    event.preventDefault();
  }

  return (
    <section
      ref={workspace}
      aria-label="作文写作工作台"
      className="writing-workspace workspace-split workspace-viewport"
      data-resizable={resizable || undefined}
      style={resizable ? { '--task1-left': `${leftPercent}%` } as CSSProperties : undefined}
    >
      {reference}
      {resizable && (
        <div
          className="writing-splitter"
          role="separator"
          tabIndex={0}
          aria-label="调整题目与图表区域宽度"
          aria-orientation="vertical"
          aria-controls="writing-reference"
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={leftPercent}
          aria-valuetext={`左栏 ${leftPercent}%`}
          title="拖动调整分栏，双击恢复均分"
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary || !workspace.current) return;
            event.preventDefault(); // Keep the insertion point in the essay while dragging.
            const bounds = workspace.current.getBoundingClientRect();
            grabOffset.current = event.clientX - (bounds.left + bounds.width * leftPercent / 100);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!event.isPrimary || !workspace.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = workspace.current.getBoundingClientRect();
            const x = event.clientX - grabOffset.current - bounds.left;
            setLeftPercent(clamp(Math.round(x / bounds.width * 1000) / 10));
          }}
          onDoubleClick={() => setLeftPercent(DEFAULT)}
          onKeyDown={adjustWithKeyboard}
        />
      )}
      {manuscript}
    </section>
  );
}
