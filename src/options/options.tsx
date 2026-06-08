import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@/shared/settings';
import type {
  BlankTabPolicy,
  ConsolidateTarget,
  KeepPolicy,
  Settings,
} from '@/shared/types';
import '@/options/options.css';

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  if (!settings) return <main class="opt">Loading…</main>;

  // Persist on every change; flash a "Saved" indicator.
  function update(patch: Partial<Settings>) {
    const next = { ...settings!, ...patch };
    setSettings(next);
    void saveSettings(next).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  }

  function updateNormalize(patch: Partial<Settings['normalize']>) {
    update({ normalize: { ...settings!.normalize, ...patch } });
  }

  const n = settings.normalize;

  return (
    <main class="opt">
      <header>
        <h1>Tabby Settings</h1>
        <span class={`saved ${saved ? 'show' : ''}`}>Saved ✓</span>
      </header>

      <Section title="Duplicate matching" desc="How two tabs count as the same.">
        <Check
          label="Ignore #fragments"
          checked={n.dropFragment}
          onChange={(v) => updateNormalize({ dropFragment: v })}
        />
        <Check
          label="Strip tracking params (utm_*, fbclid, …)"
          checked={n.stripTrackingParams}
          onChange={(v) => updateNormalize({ stripTrackingParams: v })}
        />
        <Check
          label="Ignore trailing slash"
          checked={n.dropTrailingSlash}
          onChange={(v) => updateNormalize({ dropTrailingSlash: v })}
        />
        <Check
          label="Treat www. and bare domain as the same"
          checked={n.ignoreWww}
          onChange={(v) => updateNormalize({ ignoreWww: v })}
        />
        <Check
          label="Ignore ALL query params (aggressive)"
          checked={n.stripAllQuery}
          onChange={(v) => updateNormalize({ stripAllQuery: v })}
        />
        <label class="field">
          <span>Tracking-param blocklist (one per line, supports prefix*)</span>
          <textarea
            rows={5}
            value={n.trackingParams.join('\n')}
            disabled={!n.stripTrackingParams}
            onChange={(e) =>
              updateNormalize({
                trackingParams: (e.currentTarget as HTMLTextAreaElement).value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </Section>

      <Section title="Which copy to keep" desc="When duplicates are collapsed.">
        <Radio<KeepPolicy>
          name="keepPolicy"
          value={settings.keepPolicy}
          onChange={(v) => update({ keepPolicy: v })}
          options={[
            ['most-recent', 'Most recently active'],
            ['oldest', 'Oldest'],
            ['leftmost', 'Leftmost in the strip'],
          ]}
        />
      </Section>

      <Section title="Protected tabs" desc="Never moved, deduped, or closed.">
        <Check
          label="Protect pinned tabs"
          checked={settings.protectPinned}
          onChange={(v) => update({ protectPinned: v })}
        />
        <Check
          label="Protect tabs playing audio"
          checked={settings.protectAudible}
          onChange={(v) => update({ protectAudible: v })}
        />
        <Check
          label="Preserve tab groups when consolidating"
          checked={settings.preserveGroups}
          onChange={(v) => update({ preserveGroups: v })}
        />
        <p class="note">The active tab of each window is always protected.</p>
      </Section>

      <Section
        title="Blank tabs"
        desc="about:blank, new-tab pages, and empty tabs."
      >
        <Radio<BlankTabPolicy>
          name="blankTabPolicy"
          value={settings.blankTabPolicy}
          onChange={(v) => update({ blankTabPolicy: v })}
          options={[
            ['purge', 'Close them (keep the active one)'],
            ['collapse', 'Collapse to a single blank tab'],
            ['protect', 'Keep all blank tabs'],
          ]}
        />
      </Section>

      <Section title="Consolidation" desc="Where tabs gather and how you commit.">
        <Radio<ConsolidateTarget>
          name="consolidateTarget"
          value={settings.consolidateTarget}
          onChange={(v) => update({ consolidateTarget: v })}
          options={[
            ['focused-window', 'Into the focused window'],
            ['new-window', 'Into a new window'],
          ]}
        />
        <Check
          label="Ask before closing marked tabs"
          checked={settings.confirmBeforeCommit}
          onChange={(v) => update({ confirmBeforeCommit: v })}
        />
      </Section>

      <footer>
        <button class="reset" onClick={() => update(DEFAULT_SETTINGS)}>
          Reset to defaults
        </button>
        <span class="hint">
          Shortcut: change it at <code>chrome://extensions/shortcuts</code>
        </span>
      </footer>
    </main>
  );
}

function Section(props: {
  title: string;
  desc: string;
  children: preact.ComponentChildren;
}) {
  return (
    <section>
      <h2>{props.title}</h2>
      <p class="desc">{props.desc}</p>
      {props.children}
    </section>
  );
}

function Check(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function Radio<T extends string>(props: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div class="radio-group">
      {props.options.map(([val, label]) => (
        <label class="check" key={val}>
          <input
            type="radio"
            name={props.name}
            checked={props.value === val}
            onChange={() => props.onChange(val)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<Options />, root);
