import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';

interface RowProps {
  tab: TabInfo;
  isCursor: boolean;
  isMarked: boolean;
  onClick: () => void;
  onToggle: () => void;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url || '(blank)';
  }
}

export function Row({ tab, isCursor, isMarked, onClick, onToggle }: RowProps) {
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
      </span>
    </li>
  );
}
