import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import type { RecommendReason } from '@/core/recommend';

interface RowProps {
  tab: TabInfo;
  isCursor: boolean;
  isMarked: boolean;
  /** Advisory close-recommendation reasons (kata 9kb5); absent = no flag. */
  recommendReasons?: RecommendReason[];
  onClick: () => void;
  onToggle: () => void;
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
  recommendReasons,
  onClick,
  onToggle,
}: RowProps) {
  const cls = ['row', isCursor && 'cursor', isMarked && 'marked']
    .filter(Boolean)
    .join(' ');

  return (
    <li class={cls} onClick={onClick}>
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
      <span class="url">{hostOf(tab.url)}</span>
      <span class="title">{tab.title}</span>
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
    </li>
  );
}
