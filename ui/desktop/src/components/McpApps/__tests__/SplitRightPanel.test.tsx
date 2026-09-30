import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useRef } from 'react';
import { IntlTestWrapper } from '../../../i18n/test-utils';
import {
  SPLIT_RIGHT_MIN_CHAT_WIDTH,
  SPLIT_RIGHT_MIN_WIDTH,
  SplitRightPanel,
  clampSplitRightWidth,
  clearSplitRightWidthStore,
  loadSplitRightWidth,
  useSplitRightPanel,
} from '../SplitRightPanel';

describe('clampSplitRightWidth', () => {
  it('enforces the minimum width', () => {
    expect(clampSplitRightWidth(100, 1200)).toBe(SPLIT_RIGHT_MIN_WIDTH);
  });

  it('leaves the minimum chat width free', () => {
    expect(clampSplitRightWidth(5000, 1200)).toBe(1200 - SPLIT_RIGHT_MIN_CHAT_WIDTH);
  });

  it('keeps the minimum width when the window is too narrow for both', () => {
    expect(clampSplitRightWidth(500, 400)).toBe(SPLIT_RIGHT_MIN_WIDTH);
  });

  it('rounds widths within bounds', () => {
    expect(clampSplitRightWidth(480.4, 1200)).toBe(480);
  });
});

function Harness() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const split = useSplitRightPanel({ active: true, anchorRef });
  return (
    <div data-mcp-split-host>
      <div ref={anchorRef}>
        <SplitRightPanel
          resizeHandlers={split.resizeHandlers}
          width={split.width}
          maxWidth={split.maxWidth}
          title="App"
          onClose={() => {}}
        />
      </div>
    </div>
  );
}

describe('split-right keyboard resize', () => {
  beforeEach(() => {
    clearSplitRightWidthStore();
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('changes the width with arrow keys and stays within bounds', () => {
    render(<Harness />, { wrapper: IntlTestWrapper });
    const handle = screen.getByRole('separator');
    const min = SPLIT_RIGHT_MIN_WIDTH;
    const max = window.innerWidth - SPLIT_RIGHT_MIN_CHAT_WIDTH;
    const now = () => Number(handle.getAttribute('aria-valuenow'));

    expect(handle.getAttribute('aria-valuemin')).toBe(String(min));
    expect(handle.getAttribute('aria-valuemax')).toBe(String(max));
    const start = now();

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(now()).toBe(start + 16);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(now()).toBe(start + 16 - 64);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(now()).toBe(min);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(now()).toBe(min);

    fireEvent.keyDown(handle, { key: 'End' });
    expect(now()).toBe(max);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(now()).toBe(max);
  });

  it('keeps the chosen width when the window shrinks for a while', () => {
    const originalWidth = window.innerWidth;
    render(<Harness />, { wrapper: IntlTestWrapper });
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'End' });
    const chosen = Number(handle.getAttribute('aria-valuenow'));

    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
      fireEvent(window, new Event('resize'));
      expect(Number(handle.getAttribute('aria-valuenow'))).toBe(800 - SPLIT_RIGHT_MIN_CHAT_WIDTH);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      fireEvent(window, new Event('resize'));
    }
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(chosen);
    expect(loadSplitRightWidth(originalWidth)).toBe(chosen);
  });
});
