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
import { keymap, type Intent } from '@/view/keymap';
import { Row } from '@/view/Row';
import {
  currentTab,
  initialState,
  reduce,
  visibleTabs,
  type Action,
  type ReviewUiState,
} from '@/view/state';
import type { ReviewTransport } from '@/view/transport';

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
  ['u', 'undo last close'],
  ['?', 'toggle this help'],
];

export function ReviewView({ transport }: { transport: ReviewTransport }) {
  const [state, dispatch] = useReducer(reduce, undefined, () =>
    initialState([]),
  );
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const filterRef = useRef<HTMLInputElement>(null);
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
    const tabs = await transport.queryTabs(windowId);
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

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
        if (
          confirmRef.current &&
          !window.confirm(`Close ${ids.length} tab(s)?`)
        ) {
          return;
        }
        const closed = await transport.commitClose(ids);
        dispatch({ type: 'removeTabs', ids });
        setToast(`Closed ${closed}. Press u to undo.`);
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

  const visible = visibleTabs(state);
  const markedCount = state.marked.size;
  const items = renderItems(state, visible);

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
        <ol class="list">
          {items.map((item) =>
            item.kind === 'header' ? (
              <GroupHeader
                key={`group-${item.groupId}`}
                groupId={item.groupId}
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
                onClick={() => void transport.jumpTo(item.tab.id)}
                onToggle={() => {
                  dispatch({ type: 'move', delta: item.index - state.cursor });
                  dispatch({ type: 'toggleMark' });
                }}
              />
            ),
          )}
        </ol>
      )}

      {toast && <div class="toast">{toast}</div>}
      {state.showHelp && <Help />}
    </div>
  );
}

/**
 * One entry in the rendered list: either a group header or a tab row. Headers
 * are emitted from the canonical tab order so a collapsed group (which has no
 * visible members) still shows its header in place. `index` on a row is its
 * position in `visibleTabs`, which is what the cursor indexes. (kata#yrez)
 */
type RenderItem =
  | { kind: 'header'; groupId: number }
  | { kind: 'row'; tab: TabInfo; index: number };

function matchesFilter(tab: TabInfo, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return (
    tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
  );
}

function renderItems(state: ReviewUiState, visible: TabInfo[]): RenderItem[] {
  const items: RenderItem[] = [];
  const headered = new Set<number>();
  // Row indices come straight from `visible`, whose order matches the canonical
  // tab order we walk here (same filter + collapse predicate).
  const indexOf = new Map<number, number>();
  visible.forEach((t, i) => indexOf.set(t.id, i));

  for (const tab of state.tabs) {
    // A collapsed group's members are hidden but still count toward whether the
    // group matches the filter (so its header stays put).
    if (isGrouped(tab) && state.collapsed.has(tab.groupId)) {
      if (matchesFilter(tab, state.filter) && !headered.has(tab.groupId)) {
        items.push({ kind: 'header', groupId: tab.groupId });
        headered.add(tab.groupId);
      }
      continue;
    }
    if (!matchesFilter(tab, state.filter)) continue;
    if (isGrouped(tab) && !headered.has(tab.groupId)) {
      items.push({ kind: 'header', groupId: tab.groupId });
      headered.add(tab.groupId);
    }
    items.push({ kind: 'row', tab, index: indexOf.get(tab.id) ?? 0 });
  }
  return items;
}

/** Collapsible header for a tab group: marker + name + tab / to-close counts. */
function GroupHeader({
  groupId,
  tabs,
  marked,
  collapsed,
  onToggle,
}: {
  groupId: number;
  tabs: TabInfo[];
  marked: Set<number>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Counts are over ALL members (collapse is display-only — totals never change).
  const members = tabs.filter((t) => isGrouped(t) && t.groupId === groupId);
  const toClose = members.filter((t) => marked.has(t.id)).length;
  return (
    <li class="group-divider" onClick={onToggle}>
      <span class="group-marker">{collapsed ? '▸' : '▾'}</span> group {groupId}{' '}
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
