import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';

import type { Settings, TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import { sortTabs } from '@/core/sortTabs';
import type { RecommendReason } from '@/core/recommend';
import { keymap, type Intent } from '@/view/keymap';
import { Row } from '@/view/Row';
import { ContextMenu } from '@/view/ContextMenu';
import { useContextMenu } from '@/view/useContextMenu';
import { useMarquee } from '@/view/useMarquee';
import { renderItems } from '@/view/renderItems';
import { computeWindow, scrollToShow } from '@/view/virtualize';
import {
  currentTab,
  initialState,
  reduce,
  visibleTabs,
  type Action,
} from '@/view/state';
import type { ReviewTransport } from '@/view/transport';

/** Default rendered-row height (px); kept in sync with --row-h in review.css. */
const ROW_HEIGHT = 28;
/** Extra rows rendered above/below the viewport so fast scrolls stay smooth. */
const OVERSCAN = 8;

interface Meta {
  closedCount: number;
  emptyWindowIds: number[];
  stayingPinnedTabIds: number[];
  confirmBeforeCommit: boolean;
}

const HELP: [string, string][] = [
  ['j / k', 'move down / up'],
  ['g / G', 'top / bottom'],
  ['x / space', 'mark for closing'],
  ['V then move, x', 'mark a range'],
  ['a / A', 'mark all / clear marks'],
  ['/', 'filter'],
  ['z', 'collapse / expand group'],
  ['enter', 'jump to tab'],
  ['⌘/ctrl + enter', 'close marked tabs'],
  ['shift + S', 'stash marked tabs (save + close)'],
  ['u', 'undo last close'],
  ['mouse', 'click row to mark · click title/host to open · drag to select'],
  ['?', 'toggle this help'],
];

export function ReviewView({ transport }: { transport: ReviewTransport }) {
  const [state, dispatch] = useReducer(reduce, undefined, () =>
    initialState([]),
  );
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Advisory close-recommendation reasons by tab id (kata 9kb5).
  const [recs, setRecs] = useState<ReadonlyMap<number, RecommendReason[]>>(
    new Map(),
  );
  // Tab-group titles by group id, so the divider shows the group's name rather
  // than its opaque numeric id. Refreshed alongside the live tab reconcile.
  const [groupTitles, setGroupTitles] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );

  const filterRef = useRef<HTMLInputElement>(null);
  // Virtualization: the scroll viewport + its current scroll/height drive which
  // slice of items renders. Defaults give a sane first paint before measurement.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  // Mirror of scrollTop the cursor-scroll effect reads without a render dep.
  const scrollTopRef = useRef(0);
  scrollTopRef.current = scrollTop;
  // The scrollTop value we last set programmatically; lets onScroll ignore the
  // echo of our own scroll (which a layout-less env may report clamped).
  const programmaticTopRef = useRef<number | null>(null);
  // Keyboard handler reads the latest state/flags without re-binding the listener.
  const stateRef = useRef(state);
  stateRef.current = state;
  const confirmRef = useRef(false);
  confirmRef.current = meta?.confirmBeforeCommit ?? false;

  // The window the review mirrors + the sort settings, read by the reconcile
  // path. Refs so the event/focus handlers always see the latest without
  // re-binding their listeners.
  const windowIdRef = useRef<number | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  // Fetch the run summary (the "what the last run did" header) and the sort
  // settings into refs/meta. The list itself comes from live tabs (reconcile).
  const loadMeta = useCallback(async () => {
    const [review, settings] = await Promise.all([
      transport.getReview(),
      transport.getSettings(),
    ]);
    settingsRef.current = settings;
    if (review) {
      windowIdRef.current = review.targetWindowId;
      setMeta({
        closedCount: review.closedCount,
        emptyWindowIds: review.emptyWindowIds,
        stayingPinnedTabIds: review.stayingPinnedTabIds,
        confirmBeforeCommit: review.confirmBeforeCommit,
      });
    }
    return review;
  }, [transport]);

  // Reconcile the displayed list to the window's live tabs, re-sorted with the
  // same ordering the cleanup used so new tabs slot in sensibly. Marks/cursor/
  // filter are preserved by the 'sync' reducer. (kata#xtwp)
  const reconcile = useCallback(async () => {
    const windowId = windowIdRef.current;
    const settings = settingsRef.current;
    if (windowId == null || settings == null) return;
    const [tabs, groups] = await Promise.all([
      transport.queryTabs(windowId),
      transport.queryGroups(windowId),
    ]);
    setGroupTitles(new Map(groups.map((g) => [g.id, g.title])));
    dispatch({ type: 'sync', tabs: sortTabs(tabs, settings) });
  }, [transport]);

  // Mount: paint the stashed snapshot for an instant first frame, then replace
  // it with live state.
  useEffect(() => {
    void (async () => {
      const review = await loadMeta();
      if (review) dispatch({ type: 'load', tabs: review.reviewTabs });
      setLoaded(true);
      await reconcile();
    })();
  }, [loadMeta, reconcile]);

  // The worker re-stashed after another run (possibly a different window /
  // settings): refresh the summary, then reconcile to live tabs.
  useEffect(
    () => transport.onReviewUpdated(() => void loadMeta().then(reconcile)),
    [transport, loadMeta, reconcile],
  );

  // Re-focusing the page reconciles to live state (also covers a missed event).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reconcile]);

  // Live sync: any tab/group change in the window triggers a debounced
  // reconcile (a single move fires several events in a burst).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = transport.onTabsChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void reconcile(), 120);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [transport, reconcile]);

  // Refresh advisory flags whenever the displayed tab set changes. Stale
  // responses are dropped so a slow round-trip can't overwrite a newer one.
  useEffect(() => {
    if (state.tabs.length === 0) {
      setRecs(new Map());
      return;
    }
    let cancelled = false;
    void transport.getRecommendations(state.tabs).then((recommendations) => {
      if (cancelled) return;
      setRecs(new Map(recommendations.map((r) => [r.tabId, r.reasons])));
    });
    return () => {
      cancelled = true;
    };
  }, [transport, state.tabs]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // The cursor row's index into the *rendered items* list (headers + rows),
  // kept in a ref so the scroll-into-view effect below sees the latest position
  // without re-deriving the item order. Set during render.
  const cursorItemIndexRef = useRef(0);

  // Keep the cursor row on screen: when j/k/gg/G move it outside the rendered
  // window, scroll the viewport so the slice re-centres on it. Driven by the
  // tracked scrollTop state (the source of truth for the window) so it works
  // even where real layout is absent (jsdom); the DOM element is nudged to match.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const target = scrollToShow(
      cursorItemIndexRef.current,
      scrollTopRef.current,
      el.clientHeight || viewportHeight,
      ROW_HEIGHT,
    );
    if (target != null) {
      // Mark this as a programmatic scroll so the resulting onScroll (which in a
      // layout-less environment may report a clamped value) doesn't clobber the
      // state-driven window.
      programmaticTopRef.current = target;
      scrollTopRef.current = target;
      el.scrollTop = target;
      setScrollTop(target);
    }
    // Deps cover everything that can move the cursor's rendered row: cursor
    // position, the tab set, the filter, and collapse state (collapsing a group
    // above the cursor shifts its rendered index).
  }, [state.cursor, state.tabs, state.filter, state.collapsed, viewportHeight]);

  // Track the viewport's live height so the render window covers it. We read it
  // once on mount and on resize; scroll is tracked via onScroll below.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight || viewportHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Re-measure once the list first appears (loaded toggles the viewport in).
  }, [loaded]);

  // Close / stash a specific set of tabs, then drop them from the list. Shared
  // by the keyboard commit/stash, the per-row × button, and the context menu —
  // each just supplies the ids. Both are undoable (the worker tracks the last
  // closed batch). Empty sets are ignored; callers that want a "nothing marked"
  // toast check before calling.
  async function closeTabs(ids: number[]) {
    if (ids.length === 0) return;
    if (confirmRef.current && !window.confirm(`Close ${ids.length} tab(s)?`)) {
      return;
    }
    const closed = await transport.commitClose(ids);
    dispatch({ type: 'removeTabs', ids });
    setToast(`Closed ${closed}. Press u to undo.`);
  }

  async function stashTabs(ids: number[]) {
    if (ids.length === 0) return;
    const { stashed, closed } = await transport.stashClose(ids);
    dispatch({ type: 'removeTabs', ids });
    setToast(`Stashed ${stashed}, closed ${closed}. Press u to undo.`);
  }

  async function handleIntent(intent: Intent) {
    switch (intent.type) {
      case 'focusFilter':
        filterRef.current?.focus();
        return;
      case 'setFiltering':
        if (!intent.on) filterRef.current?.blur();
        dispatch(intent);
        return;
      case 'jump': {
        const tab = currentTab(stateRef.current);
        if (tab) await transport.jumpTo(tab.id);
        return;
      }
      case 'commit': {
        const ids = [...stateRef.current.marked];
        if (ids.length === 0) {
          setToast('Nothing marked.');
          return;
        }
        await closeTabs(ids);
        return;
      }
      case 'stash': {
        const ids = [...stateRef.current.marked];
        if (ids.length === 0) {
          setToast('Nothing marked.');
          return;
        }
        await stashTabs(ids);
        return;
      }
      case 'undo': {
        const restored = await transport.undo();
        setToast(restored ? `Restored ${restored}.` : 'Nothing to undo.');
        return;
      }
      default:
        dispatch(intent as Action);
    }
  }

  // Global keyboard listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const intent = keymap(e, stateRef.current.filtering);
      if (!intent) return;
      e.preventDefault();
      void handleIntent(intent);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derived list order. Computed (and the marquee hook called) BEFORE the early
  // returns below so every render runs the same hooks in the same order — the
  // Rules of Hooks. `items` is the single source of row order the virtualizer,
  // the cursor mapping, and the marquee all share.
  const visible = visibleTabs(state);
  const items = renderItems(state, visible);

  // Mouse drag-marquee over the list (kata rxxe): a vertical band additively
  // marks the rows it covers, reading the same `items`/row height as the
  // virtualizer and committing into the shared `marked` set.
  const marquee = useMarquee({
    viewportRef,
    items,
    rowHeight: ROW_HEIGHT,
    dispatch,
  });

  // Right-click menu over a row (kata rz1c): opens a Tabby menu in place of
  // Chrome's. Its actions reuse the same close/stash/mark paths as the keyboard.
  const ctx = useContextMenu();

  if (!loaded) return <Shell>Loading…</Shell>;
  if (!meta) {
    return (
      <Shell>
        <p class="empty">
          No cleanup has run yet. Click the Tabby icon to start.
        </p>
      </Shell>
    );
  }

  const markedCount = state.marked.size;

  // `items` (the group-header + row order) and `visible` are computed above the
  // early returns. The rendered-items index of the cursor row, recorded for the
  // scroll effect.
  // The cursor indexes `visibleTabs`; a row item's `index` is that same value,
  // so map cursor → rendered-item index (headers shift it down).
  const cursorItemIndex = items.findIndex(
    (it) => it.kind === 'row' && it.index === state.cursor,
  );
  cursorItemIndexRef.current = cursorItemIndex < 0 ? 0 : cursorItemIndex;
  const win = computeWindow(
    items.length,
    scrollTop,
    viewportHeight,
    ROW_HEIGHT,
    OVERSCAN,
  );
  const windowItems = items.slice(win.start, win.end);

  async function closeEmpty() {
    if (!meta) return;
    const n = await transport.closeEmptyWindows(meta.emptyWindowIds);
    setMeta({ ...meta, emptyWindowIds: [] });
    setToast(`Closed ${n} empty window(s).`);
  }

  return (
    <div class="app">
      <header class="header">
        <h1>Tabby</h1>
        <span class="counts">
          <b>{state.tabs.length}</b> tabs · <b>{markedCount}</b> marked ·{' '}
          {meta.closedCount} auto-closed
          {meta.stayingPinnedTabIds.length > 0 &&
            ` · ${meta.stayingPinnedTabIds.length} pinned left in place`}
        </span>
        <input
          ref={filterRef}
          class="filter"
          placeholder="/ filter…"
          value={state.filter}
          onFocus={() => dispatch({ type: 'setFiltering', on: true })}
          onBlur={() => dispatch({ type: 'setFiltering', on: false })}
          onInput={(e) =>
            dispatch({
              type: 'setFilter',
              query: (e.currentTarget as HTMLInputElement).value,
            })
          }
        />
        {meta.emptyWindowIds.length > 0 && (
          <button class="btn" onClick={closeEmpty}>
            Close {meta.emptyWindowIds.length} empty
          </button>
        )}
        <button class="btn" onClick={() => void handleIntent({ type: 'undo' })}>
          Undo
        </button>
        <button
          class="btn primary"
          disabled={markedCount === 0}
          onClick={() => void handleIntent({ type: 'commit' })}
        >
          Close {markedCount || ''}
        </button>
      </header>

      {items.length === 0 ? (
        <p class="empty">
          {state.tabs.length === 0
            ? 'Nothing to review — no tabs left to remove. 🎉'
            : 'No tabs match the filter.'}
        </p>
      ) : (
        <div
          class="list-viewport"
          ref={viewportRef}
          onMouseDown={marquee.onMouseDown}
          onClickCapture={marquee.onClickCapture}
          onContextMenu={ctx.onContextMenu}
          onScroll={(e) => {
            const top = (e.currentTarget as HTMLElement).scrollTop;
            // Ignore the echo of a programmatic scroll-into-view (esp. when the
            // environment clamps scrollTop to a stale layout height).
            if (programmaticTopRef.current != null) {
              programmaticTopRef.current = null;
              return;
            }
            scrollTopRef.current = top;
            setScrollTop(top);
          }}
        >
          <ol class="list">
            {marquee.band && (
              <div
                class="marquee-band"
                style={{
                  top: `${marquee.band.top}px`,
                  height: `${marquee.band.height}px`,
                }}
              />
            )}
            {win.padTop > 0 && (
              <li
                key="spacer-top"
                class="list-spacer"
                style={{ height: `${win.padTop}px` }}
              />
            )}
            {windowItems.map((item) =>
              item.kind === 'header' ? (
                <GroupHeader
                  key={`group-${item.groupId}`}
                  groupId={item.groupId}
                  title={groupTitles.get(item.groupId)}
                  tabs={state.tabs}
                  marked={state.marked}
                  collapsed={state.collapsed.has(item.groupId)}
                  onToggle={() =>
                    dispatch({
                      type: 'toggleCollapse',
                      groupId: item.groupId,
                    })
                  }
                />
              ) : (
                <Row
                  key={item.tab.id}
                  tab={item.tab}
                  isCursor={item.index === state.cursor}
                  isMarked={state.marked.has(item.tab.id)}
                  isPending={marquee.pendingIds.has(item.tab.id)}
                  recommendReasons={recs.get(item.tab.id)}
                  onActivate={() => void transport.jumpTo(item.tab.id)}
                  onToggle={() => dispatch({ type: 'toggleMarkId', id: item.tab.id })}
                  onClose={() => void closeTabs([item.tab.id])}
                />
              ),
            )}
            {win.padBottom > 0 && (
              <li
                key="spacer-bottom"
                class="list-spacer"
                style={{ height: `${win.padBottom}px` }}
              />
            )}
          </ol>
        </div>
      )}

      {ctx.menu && (
        <ContextMenu
          menu={ctx.menu}
          marked={state.marked}
          onCloseTabs={(ids) => void closeTabs(ids)}
          onStashTabs={(ids) => void stashTabs(ids)}
          onMarkTabs={(ids) => dispatch({ type: 'markIds', ids })}
          onUnmarkTabs={(ids) => dispatch({ type: 'unmarkIds', ids })}
          onJump={(id) => void transport.jumpTo(id)}
          onDismiss={ctx.close}
        />
      )}
      {toast && <div class="toast">{toast}</div>}
      {state.showHelp && <Help />}
    </div>
  );
}

/** Collapsible header for a tab group: marker + name + tab / to-close counts. */
function GroupHeader({
  groupId,
  title,
  tabs,
  marked,
  collapsed,
  onToggle,
}: {
  groupId: number;
  title?: string;
  tabs: TabInfo[];
  marked: Set<number>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Counts are over ALL members (collapse is display-only — totals never change).
  const members = tabs.filter((t) => isGrouped(t) && t.groupId === groupId);
  const toClose = members.filter((t) => marked.has(t.id)).length;
  // Show the group's name; Chrome lets a group be untitled, so fall back to a
  // generic label rather than leaking the opaque numeric group id.
  const name = title?.trim() ? title : 'Group';
  return (
    <li class="group-divider" onClick={onToggle}>
      <span class="group-marker">{collapsed ? '▸' : '▾'}</span> {name}{' '}
      <span class="group-counts">
        {members.length} tabs · {toClose} to close
      </span>
    </li>
  );
}

function Help() {
  return (
    <div class="help">
      <div class="help-card">
        <h2>Keyboard shortcuts</h2>
        <dl>
          {HELP.map(([keys, desc]) => (
            <>
              <dt>{keys}</dt>
              <dd>{desc}</dd>
            </>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="app">
      <header class="header">
        <h1>Tabby</h1>
      </header>
      {children}
    </div>
  );
}
