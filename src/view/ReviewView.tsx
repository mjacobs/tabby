import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';

import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import { keymap, type Intent } from '@/view/keymap';
import { Row } from '@/view/Row';
import {
  currentTab,
  initialState,
  reduce,
  visibleTabs,
  type Action,
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

  // Pull the stashed cleanup result and replace the view's state with it.
  // Used for the initial mount and to reconcile to the latest stash whenever
  // the worker re-runs or the page regains focus (kata#zpsb).
  const refresh = useCallback(() => {
    return transport.getReview().then((review) => {
      if (review) {
        dispatch({ type: 'load', tabs: review.reviewTabs });
        setMeta({
          closedCount: review.closedCount,
          emptyWindowIds: review.emptyWindowIds,
          stayingPinnedTabIds: review.stayingPinnedTabIds,
          confirmBeforeCommit: review.confirmBeforeCommit,
        });
      }
      setLoaded(true);
    });
  }, [transport]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Push path: the worker re-stashed after another run — reconcile in place.
  useEffect(() => transport.onReviewUpdated(() => void refresh()), [
    transport,
    refresh,
  ]);

  // Pull path (belt-and-suspenders): re-fetch when the page regains focus, in
  // case a broadcast was missed (e.g. the page was discarded/suspended).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // Live sync: tabs closed/updated outside the review.
  useEffect(() => {
    const offRemoved = transport.onTabRemoved((id) =>
      dispatch({ type: 'removeTabs', ids: [id] }),
    );
    const offUpdated = transport.onTabUpdated((id, title, url) =>
      dispatch({ type: 'updateTab', id, title, url }),
    );
    return () => {
      offRemoved();
      offUpdated();
    };
  }, [transport]);

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

      {visible.length === 0 ? (
        <p class="empty">
          {state.tabs.length === 0
            ? 'Nothing to review — no tabs left to remove. 🎉'
            : 'No tabs match the filter.'}
        </p>
      ) : (
        <ol class="list">
          {visible.map((tab, i) => (
            <>
              <GroupDivider tab={tab} prev={visible[i - 1]} />
              <Row
                key={tab.id}
                tab={tab}
                isCursor={i === state.cursor}
                isMarked={state.marked.has(tab.id)}
                onClick={() => void transport.jumpTo(tab.id)}
                onToggle={() => {
                  dispatch({ type: 'move', delta: i - state.cursor });
                  dispatch({ type: 'toggleMark' });
                }}
              />
            </>
          ))}
        </ol>
      )}

      {toast && <div class="toast">{toast}</div>}
      {state.showHelp && <Help />}
    </div>
  );
}

/** Renders a divider when entering a new tab group. */
function GroupDivider({ tab, prev }: { tab: TabInfo; prev?: TabInfo }) {
  if (!isGrouped(tab)) return null;
  if (prev && prev.groupId === tab.groupId) return null;
  return <li class="group-divider">group {tab.groupId}</li>;
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
