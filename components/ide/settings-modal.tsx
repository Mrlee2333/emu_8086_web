"use client";

import { useEffect, useRef, useState } from "react";
import { AdSenseUnit, AD_SLOTS } from "@/components/ads/adsense-unit";
import { AuthorContacts } from "@/components/ide/author-contacts";
import { DialogShell } from "@/components/ide/dialog-shell";
import { IconGitHub } from "@/components/ide/editor-icons";
import { THEME_KEY } from "@/lib/emulator";
import {
  ACCENT_KEY,
  applyAccent,
  AUTO_UPDATE_KEY,
  defaultAccentForTheme,
  FONT_SCALE_KEY,
  isDesktop,
  loadAccent,
  mirrorPrefs,
  TAB_SIZE_KEY,
  type TabSize,
  WORD_WRAP_KEY,
} from "@/lib/ide/editor-prefs";
import {
  APP_AUTHOR,
  APP_NAME,
  APP_REPO_URL,
  APP_TAGLINE,
  APP_VERSION,
} from "@/lib/version";

type Theme = "dark" | "light";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  tabSize: TabSize;
  onTabSizeChange: (size: TabSize) => void;
  wordWrap: boolean;
  onWordWrapChange: (wrap: boolean) => void;
  autoUpdate: boolean;
  onAutoUpdateChange: (enabled: boolean) => void;
}

export function SettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
  tabSize,
  onTabSizeChange,
  wordWrap,
  onWordWrapChange,
  autoUpdate,
  onAutoUpdateChange,
}: SettingsModalProps) {
  const [fontScale, setFontScale] = useState(100);
  const [accent, setAccent] = useState(defaultAccentForTheme(theme));
  /** True when the accent came from storage, i.e. the user chose it. */
  const [accentChosen, setAccentChosen] = useState(false);
  /**
   * Staged, like every other control here. It was previously applied the
   * instant the box was ticked, which meant it was the one setting in the
   * dialog that ignored Cancel — untick it, press Cancel, and it stayed off.
   */
  const [autoUpdateDraft, setAutoUpdateDraft] = useState(autoUpdate);
  const onDesktop = isDesktop();

  // Read the stored preferences once per open, deferred so the first client
  // paint matches the server.
  //
  // The accent is decided entirely here, from storage, and `accentChosen`
  // records whether it came from the user or is only a default. Both are set in
  // the same microtask so the follow-theme effect below cannot observe a
  // half-loaded pair: run separately, its own microtask landed after this one
  // and overwrote a stored colour with the default.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      const scale = localStorage.getItem(FONT_SCALE_KEY);
      if (scale) setFontScale(Number(scale) || 100);
      const stored = loadAccent();
      setAccentChosen(stored !== null);
      setAccent(stored ?? defaultAccentForTheme(theme));
      setAutoUpdateDraft(autoUpdate);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per open
  }, [open]);

  // Follow the theme, but only for an accent the user never chose.
  //
  // Re-reading storage on every theme change was the bug before v1.5.2: it threw
  // away a colour someone had picked. Dropping the theme dependency instead
  // fixed that and created the opposite one — on a fresh profile, opening
  // Settings in dark and then choosing Light saved the *dark* default accent
  // into a light theme, because the effect had already filled the swatch. So
  // the two cases are separated explicitly: a chosen accent is the user's, a
  // defaulted one merely follows the theme.
  //
  // The ref keeps this to *changes* after the load. Without it the effect also
  // runs on the opening render, racing the load effect above.
  const accentLoadedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      accentLoadedRef.current = false;
      return;
    }
    if (!accentLoadedRef.current) {
      accentLoadedRef.current = true;
      return;
    }
    if (accentChosen) return;
    queueMicrotask(() => setAccent(defaultAccentForTheme(theme)));
  }, [open, theme, accentChosen]);

  const save = async () => {
    localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
    document.documentElement.style.fontSize = `${fontScale}%`;
    localStorage.setItem(TAB_SIZE_KEY, String(tabSize));
    localStorage.setItem(WORD_WRAP_KEY, wordWrap ? "1" : "0");
    localStorage.setItem(ACCENT_KEY, accent);
    localStorage.setItem(AUTO_UPDATE_KEY, autoUpdateDraft ? "1" : "0");
    // The staged value is what the user sees ticked, so it is the one that gets
    // persisted and mirrored. Applying the prop instead would write back the
    // pre-tick value and silently undo the change on the next launch.
    onAutoUpdateChange(autoUpdateDraft);
    applyAccent(accent, theme);
    // The main process cannot read localStorage, so the desktop app's copy has
    // to be told. A failure here must not stop the settings being applied.
    await mirrorPrefs();
    // Close on save: the dialog staying open leaves the user unsure whether
    // the settings were applied at all.
    onClose();
  };

  const resetAccent = () => {
    const d = defaultAccentForTheme(theme);
    setAccent(d);
    // Back to following the theme rather than being the user's choice.
    setAccentChosen(false);
    localStorage.removeItem(ACCENT_KEY);
    applyAccent(null, theme);
    void mirrorPrefs();
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle={APP_TAGLINE}
      panelClassName="max-w-md"
      footer={
        <div className="border-t border-line/60 pt-3">
          <AdSenseUnit slot={AD_SLOTS.banner3} compact />
        </div>
      }
    >
      <section className="space-y-5">
        <div>
          <label className="block text-xs tracking-wider text-ink-dim uppercase">
            Theme
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={`btn ${theme === "dark" ? "btn-primary" : ""}`}
              onClick={() => {
                onThemeChange("dark");
                localStorage.setItem(THEME_KEY, "dark");
              }}
            >
              Dark
            </button>
            <button
              type="button"
              className={`btn ${theme === "light" ? "btn-primary" : ""}`}
              onClick={() => {
                onThemeChange("light");
                localStorage.setItem(THEME_KEY, "light");
              }}
            >
              Light
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs tracking-wider text-ink-dim uppercase">
            Primary accent
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="color"
              value={accent}
              onChange={(e) => {
                const v = e.target.value;
                setAccent(v);
                setAccentChosen(true);
                localStorage.setItem(ACCENT_KEY, v);
                applyAccent(v, theme);
                // Mirrored here as well as on Save, or a Reset-then-close would
                // leave the main process holding an accent the user deleted and
                // restore it on the next launch that lands on a new origin.
                void mirrorPrefs();
              }}
              onBlur={() => {
                /* allow backdrop dismiss after native picker closes */
              }}
              className="h-9 w-12 cursor-pointer rounded border border-line bg-panel-2"
              title="Pick accent color"
            />
            <span className="font-mono text-xs text-ink-dim">{accent}</span>
            <button type="button" className="btn text-xs" onClick={resetAccent}>
              Reset
            </button>
          </div>
          <p className="mt-1 text-[10px] text-ink-dim">
            Primary button text auto-contrasts (black accents get white text).
          </p>
        </div>

        <div>
          <label className="block text-xs tracking-wider text-ink-dim uppercase">
            UI scale ({fontScale}%)
          </label>
          <input
            type="range"
            min={85}
            max={125}
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="mt-2 w-full accent-amber"
          />
        </div>

        <div>
          <label className="block text-xs tracking-wider text-ink-dim uppercase">
            Editor tab size
          </label>
          <div className="mt-2 flex gap-2">
            {([2, 4, 8] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`btn ${tabSize === n ? "btn-primary" : ""}`}
                onClick={() => onTabSizeChange(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="word-wrap"
            className="text-xs tracking-wider text-ink-dim uppercase"
          >
            Word wrap
          </label>
          <input
            id="word-wrap"
            type="checkbox"
            checked={wordWrap}
            onChange={(e) => onWordWrapChange(e.target.checked)}
            className="h-4 w-4 accent-amber"
          />
        </div>

        {onDesktop ? (
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="auto-update"
              className="text-xs tracking-wider text-ink-dim uppercase"
            >
              Automatic updates
            </label>
            <input
              id="auto-update"
              type="checkbox"
              checked={autoUpdateDraft}
              onChange={(e) => setAutoUpdateDraft(e.target.checked)}
              className="h-4 w-4 accent-amber"
            />
          </div>
        ) : null}
        {onDesktop ? (
          <p className="-mt-3 text-[10px] text-ink-dim">
            Off means the app never checks on its own. Help → Check for updates
            still works.
          </p>
        ) : null}

        <button type="button" className="btn btn-primary w-full" onClick={save}>
          Save settings
        </button>
      </section>

      <section className="mt-6 border-t border-line pt-5">
        <h3 className="font-mono text-xs tracking-wider text-amber uppercase">
          About
        </h3>
        <p className="mt-2 text-sm text-ink">
          {APP_NAME} v{APP_VERSION}
        </p>
        <p className="mt-1 text-xs text-ink-dim">
          Developed by {APP_AUTHOR.name} ·{" "}
          <a
            href={`mailto:${APP_AUTHOR.email}`}
            className="text-amber hover:underline"
          >
            {APP_AUTHOR.email}
          </a>
        </p>
        <a
          href={APP_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber hover:underline"
        >
          <IconGitHub className="h-3.5 w-3.5" />
          Open-source on GitHub — contributions welcome
        </a>
        <AuthorContacts className="mt-3" />
      </section>
    </DialogShell>
  );
}
