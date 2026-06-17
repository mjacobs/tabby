import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import {
  DEFAULT_SETTINGS,
  coerceSettings,
  loadSettings,
  saveSettings,
  settingsToJson,
} from '@/shared/settings';
import type {
  BlankTabPolicy,
  ConsolidateTarget,
  KeepPolicy,
  ReviewSurface,
  Settings,
} from '@/shared/types';
import '@/options/options.css';

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  if (!settings) return <main class="opt">Loading…</main>;

  function exportSettings() {
    const blob = new Blob([settingsToJson(settings!)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tabby-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    setImportMsg('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportMsg('Import failed: not valid JSON');
      return;
    }
    const { settings: next, warnings } = coerceSettings(parsed);
    setSettings(next);
    await saveSettings(next);
    setImportMsg(
      warnings.length
        ? `Imported with ${warnings.length} warning(s): ${warnings.join('; ')}`
        : 'Imported ✓',
    );
  }

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

  function updateRecommend(patch: Partial<Settings['recommend']>) {
    update({ recommend: { ...settings!.recommend, ...patch } });
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
            ['current-window', 'Only the current window (no consolidate across windows)'],
          ]}
        />
        <Check
          label="Ask before closing marked tabs"
          checked={settings.confirmBeforeCommit}
          onChange={(v) => update({ confirmBeforeCommit: v })}
        />
      </Section>

      <Section
        title="Review surface"
        desc="Where the review list appears after a cleanup run."
      >
        <SurfacePicker
          value={settings.preferredSurface}
          onChange={(v) => update({ preferredSurface: v })}
        />
      </Section>

      <Section
        title="Close suggestions"
        desc="Advisory flags in the review list — Tabby suggests, you decide. Nothing is ever closed automatically."
      >
        <Check
          label="Flag tabs that are already bookmarked"
          checked={settings.recommend.bookmarked}
          onChange={(v) => updateRecommend({ bookmarked: v })}
        />
        <Check
          label="Flag tabs stranded on a login page (session likely expired)"
          checked={settings.recommend.strandedAuth}
          onChange={(v) => updateRecommend({ strandedAuth: v })}
        />
        <label class="field">
          <span>Never flag these domains (one per line, includes subdomains)</span>
          <textarea
            rows={4}
            value={settings.recommend.excludedDomains.join('\n')}
            onChange={(e) =>
              updateRecommend({
                excludedDomains: (e.currentTarget as HTMLTextAreaElement).value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </Section>

      <Section
        title="Developer"
        desc="Diagnostics for debugging and automated testing."
      >
        <Check
          label="Log canonical tab state at each operation (debug)"
          checked={settings.debugLogging}
          onChange={(v) => update({ debugLogging: v })}
        />
        <p class="note">
          Emits structured before/after snapshots to the console and a buffer
          readable via the <code>dumpState</code> message. Off by default.
        </p>
        <Check
          label="Trace page navigations to the records log"
          checked={settings.traceNavigation}
          onChange={(v) => update({ traceNavigation: v })}
        />
        <p class="note">
          Records main-frame navigations (from/to URL, transition type) locally
          to refine the stranded-login patterns. Nothing leaves this machine.
          Off by default.
        </p>
      </Section>

      <Section
        title="Backup & restore"
        desc="Export your settings to a JSON file, or import one."
      >
        <div class="radio-group">
          <button class="reset" onClick={exportSettings}>
            Export settings…
          </button>
          <label class="reset import-btn">
            Import settings…
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                const file = input.files?.[0];
                if (file) void importFile(file);
                input.value = '';
              }}
            />
          </label>
        </div>
        {importMsg && <p class="note">{importMsg}</p>}
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

/**
 * Surface picker. Selecting "side panel" requests the optional `sidePanel`
 * permission (must be inside the user-gesture handler). On grant we save the
 * setting; on deny we leave the saved value alone and show a hint.
 */
function SurfacePicker(props: {
  value: ReviewSurface;
  onChange: (v: ReviewSurface) => void;
}) {
  const [denied, setDenied] = useState(false);

  async function choose(v: ReviewSurface) {
    setDenied(false);
    if (v === 'sidepanel') {
      const granted = await chrome.permissions.request({
        permissions: ['sidePanel'],
      });
      if (!granted) {
        setDenied(true);
        return;
      }
    }
    props.onChange(v);
  }

  return (
    <div class="radio-group">
      <label class="check">
        <input
          type="radio"
          name="preferredSurface"
          checked={props.value === 'page'}
          onChange={() => void choose('page')}
        />
        <span>Full extension page (default)</span>
      </label>
      <label class="check">
        <input
          type="radio"
          name="preferredSurface"
          checked={props.value === 'sidepanel'}
          onChange={() => void choose('sidepanel')}
        />
        <span>Side panel</span>
      </label>
      {denied && (
        <p class="note">
          Side-panel permission denied. Re-click to try again, or stay on page.
        </p>
      )}
    </div>
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
