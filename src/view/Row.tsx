import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import type { RecommendReason } from '@/core/recommend';

interface RowProps {
  tab: TabInfo;
  isCursor: boolean;
  isMarked: boolean;
  /** True while a drag-marquee band is covering this row (live preview). */
  isPending?: boolean;
  /** Advisory close-recommendation reasons (kata 9kb5); absent = no flag. */
  recommendReasons?: RecommendReason[];
  /** Jump to this tab — the title/host links (kata rxxe). */
  onActivate: () => void;
  /** Toggle this row's close-mark — row body, checkbox, advisory badge. */
  onToggle: () => void;
  /** Close just this tab immediately — the per-row × button (kata rz1c). */
  onClose: () => void;
}

/**
 * Badge label + tooltip per recommendation reason. Advisory only: clicking a
 * badge marks the tab for closing (it never closes anything directly).
 */
const REASON_BADGES: Record<RecommendReason, { label: string; title: string }> =
  {
    bookmarked: {
      label: 'bookmarked',
      title: 'Already bookmarked — click to mark for closing.',
    },
    'stranded-auth': {
      label: 'stale login',
      title:
        'Looks like a stranded login page (session likely expired) — click to mark for closing.',
    },
  };

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url || '(blank)';
  }
}

export function Row({
  tab,
  isCursor,
  isMarked,
  isPending,
  recommendReasons,
  onActivate,
  onToggle,
  onClose,
}: RowProps) {
  const cls = [
    'row',
    isCursor && 'cursor',
    isMarked && 'marked',
    isPending && 'pending',
  ]
    .filter(Boolean)
    .join(' ');

  // Title + host are links: a plain click jumps to the tab. preventDefault stops
  // the anchor's own navigation (we call jumpTo instead); stopPropagation keeps
  // the row-body toggle (the <li> onClick) from also firing. draggable=false so a
  // drag that starts on a link feeds the marquee instead of a link-drag ghost.
  const activate = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate();
  };

  return (
    <li class={cls} onClick={onToggle}>
      <input
        type="checkbox"
        class="mark"
        checked={isMarked}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label="Mark for closing"
      />
      {tab.favIconUrl ? (
        <img
          class="favicon"
          src={tab.favIconUrl}
          alt=""
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
      ) : (
        <span class="favicon placeholder" />
      )}
      <a
        class="url"
        href={tab.url}
        draggable={false}
        title={tab.url}
        onClick={activate}
      >
        {hostOf(tab.url)}
      </a>
      <a class="title" href={tab.url} draggable={false} onClick={activate}>
        {tab.title}
      </a>
      <span class="row-fill" />
      <span class="badges">
        {tab.active && <span class="badge active">active</span>}
        {tab.pinned && <span class="badge">pinned</span>}
        {tab.audible && <span class="badge">audio</span>}
        {isGrouped(tab) && <span class="badge group">group</span>}
        {recommendReasons?.map((reason) => (
          <button
            key={reason}
            class="badge suggest"
            title={REASON_BADGES[reason].title}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {REASON_BADGES[reason].label}
          </button>
        ))}
      </span>
      <button
        class="row-close"
        title="Close this tab"
        aria-label="Close this tab"
        // stopPropagation so the row-body toggle (the <li> onClick) doesn't also
        // fire; the press is excluded from the marquee in useMarquee.
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </li>
  );
}
