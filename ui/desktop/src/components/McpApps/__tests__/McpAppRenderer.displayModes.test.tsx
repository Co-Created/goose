import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlTestWrapper } from '../../../i18n/test-utils';
import McpAppRenderer from '../McpAppRenderer';
import {
  SPLIT_WIDTH_VARIABLE,
  clearSplitRightWidthStore,
  resetSplitHostWarning,
} from '../SplitRightPanel';
import type { GooseDisplayMode } from '../types';

vi.mock('@mcp-ui/client', () => ({
  AppBridge: class {
    onmessage = null;
    connect = vi.fn(() => new Promise(() => {}));
    close = vi.fn();
  },
  PostMessageTransport: class {},
}));

vi.mock('../../../acp/mcp-apps', () => ({
  readMcpAppResource: vi.fn(async () => ({ text: '<html></html>', _meta: {} })),
  callMcpAppTool: vi.fn(),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light', mcpHostStyles: {} }),
}));

vi.mock('../../settings/extensions/subcomponents/ExtensionList', () => ({
  formatExtensionName: (name: string) => name,
}));

/**
 * Display modes must never remount the app iframe: a remount reloads the app
 * and loses its state. The shell around the iframe therefore keeps the same
 * element types in the same positions in every mode, and mode-specific chrome
 * renders as siblings, never as ancestors, of the app container.
 */
describe('McpAppRenderer display modes', () => {
  const electron = window.electron as unknown as Record<string, unknown>;

  beforeEach(() => {
    clearSplitRightWidthStore();
    resetSplitHostWarning();
    electron.getAcpUrl = vi.fn(async () => 'ws://127.0.0.1:3000/acp');
    electron.getSecretKey = vi.fn(async () => 'secret');
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    delete electron.getAcpUrl;
    delete electron.getSecretKey;
  });

  function renderApp(
    displayMode: GooseDisplayMode,
    resourceUri = 'ui://bench/app',
    onDisplayModeChange?: (mode: GooseDisplayMode) => void
  ) {
    return (
      <McpAppRenderer
        resourceUri={resourceUri}
        extensionName="bench"
        sessionId="session-a"
        displayMode={displayMode}
        onDisplayModeChange={onDisplayModeChange}
      />
    );
  }

  async function findIframe(container: HTMLElement) {
    return waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
  }

  /** Posts a message from the app iframe; returns the message object after host listeners ran. */
  function postFromApp(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source: iframe.contentWindow }));
    });
    return data;
  }

  it('keeps the same iframe attached through inline, pip, split-right and fullscreen', async () => {
    const inHost = (mode: GooseDisplayMode) => <div data-mcp-split-host>{renderApp(mode)}</div>;
    const { container, rerender } = render(inHost('inline'), { wrapper: IntlTestWrapper });
    const iframe = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });

    const removals: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        removals.push(...Array.from(record.removedNodes));
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    for (const mode of [
      'pip',
      'fullscreen',
      'inline',
      'split-right',
      'fullscreen',
      'pip',
      'split-right',
      'inline',
    ] as const) {
      rerender(inHost(mode));
      expect(container.querySelector('iframe')).toBe(iframe);
      expect(iframe.isConnected).toBe(true);
      // split-right really docks here (a resize handle appears); the shell restyles without remounting.
      expect(container.querySelector('[role="separator"]') !== null).toBe(mode === 'split-right');
    }

    observer.takeRecords().forEach((record) => removals.push(...Array.from(record.removedNodes)));
    observer.disconnect();
    const detachedIframe = removals.some(
      (node) => node === iframe || (node instanceof Element && node.contains(iframe))
    );
    expect(detachedIframe).toBe(false);
  });

  it('reserves room in the split host while docked and releases it when leaving', async () => {
    const { container, rerender, unmount } = render(
      <div data-mcp-split-host>{renderApp('split-right')}</div>,
      { wrapper: IntlTestWrapper }
    );
    const host = container.querySelector<HTMLElement>('[data-mcp-split-host]')!;
    await findIframe(container);

    expect(host.style.getPropertyValue(SPLIT_WIDTH_VARIABLE)).toMatch(/^\d+px$/);

    rerender(<div data-mcp-split-host>{renderApp('inline')}</div>);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_VARIABLE)).toBe('');

    rerender(<div data-mcp-split-host>{renderApp('split-right')}</div>);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_VARIABLE)).toMatch(/^\d+px$/);

    unmount();
    expect(host.style.getPropertyValue(SPLIT_WIDTH_VARIABLE)).toBe('');
  });

  it('keeps the reservation while another docked app is still open', async () => {
    const both = (second: GooseDisplayMode) => (
      <div data-mcp-split-host>
        {renderApp('split-right', 'ui://bench/one')}
        {renderApp(second, 'ui://bench/two')}
      </div>
    );
    const { container, rerender } = render(both('split-right'), { wrapper: IntlTestWrapper });
    const host = container.querySelector<HTMLElement>('[data-mcp-split-host]')!;
    await findIframe(container);

    rerender(both('inline'));
    expect(host.style.getPropertyValue(SPLIT_WIDTH_VARIABLE)).toMatch(/^\d+px$/);
  });

  it('stays inline and warns when there is no split host', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onDisplayModeChange = vi.fn();
    const { container } = render(renderApp('split-right', undefined, onDisplayModeChange), {
      wrapper: IntlTestWrapper,
    });
    await findIframe(container);

    expect(onDisplayModeChange).toHaveBeenCalledWith('inline');
    expect(container.querySelector('[role="separator"]')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('data-mcp-split-host'));
    warn.mockRestore();
  });

  it('hides split-right from the bridge and forwards split-right requests as pip', async () => {
    const onDisplayModeChange = vi.fn();
    const { container } = render(
      <div data-mcp-split-host>{renderApp('inline', undefined, onDisplayModeChange)}</div>,
      { wrapper: IntlTestWrapper }
    );
    const iframe = await findIframe(container);
    // The host caches iframe windows through a MutationObserver.
    await act(async () => {});

    const init = postFromApp(iframe, {
      jsonrpc: '2.0',
      id: 1,
      method: 'ui/initialize',
      params: { appCapabilities: { availableDisplayModes: ['inline', 'split-right'] } },
    }) as { params: { appCapabilities: { availableDisplayModes: string[] } } };
    expect(init.params.appCapabilities.availableDisplayModes).toEqual(['inline']);

    const request = postFromApp(iframe, {
      jsonrpc: '2.0',
      id: 2,
      method: 'ui/request-display-mode',
      params: { mode: 'split-right' },
    }) as { params: { mode: string } };
    expect(request.params.mode).toBe('pip');
    expect(onDisplayModeChange).toHaveBeenCalledWith('split-right');
  });
});
