// The welcome: what someone sees the first time they open Stashd. Five short steps: what Stashd does, the
// permissions (all at once, each with its reason), Stashd AI (a plain yes or no), the Chrome helper (only
// with Chrome), and a first save. Any step can be skipped; Settings → Startup shows it again.

import { useCallback, useEffect, useState } from 'react';
import type { SetupItem } from '../shared/types';
import { api, prettyShortcut, useFitWindow, useSettings } from './api';
import { AnimatePresence, Button, FolderMark, Kbd, motion, type Mood } from './ui';

type Step = 'hello' | 'access' | 'ai' | 'chrome' | 'try';

const slide = {
  initial: { opacity: 0, transform: 'translateX(14px)' },
  animate: { opacity: 1, transform: 'translateX(0px)' },
  exit: { opacity: 0, transform: 'translateX(-14px)' },
  transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] as const },
};

function useSetupItems(): { items: SetupItem[] | null; refresh: () => void; allow: () => Promise<void>; asking: boolean } {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [asking, setAsking] = useState(false);
  const refresh = useCallback(() => void api.setupStatus().then(setItems, () => setItems([])), []);
  useEffect(() => {
    refresh();
    // Back from System Settings: look again.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  const allow = async () => {
    setAsking(true);
    try {
      setItems(await api.setupAllow());
    } finally {
      setAsking(false);
    }
  };
  return { items, refresh, allow, asking };
}

export function Welcome() {
  const settings = useSettings();
  const fit = useFitWindow<HTMLDivElement>();
  const [step, setStep] = useState<Step>('hello');
  const { items, allow, asking, refresh } = useSetupItems();
  const [saved, setSaved] = useState(false);
  const hasChrome = !!items?.some((i) => i.id === 'com.google.Chrome');
  const steps: Step[] = ['hello', 'access', 'ai', ...(hasChrome ? (['chrome'] as const) : []), 'try'];
  const at = steps.indexOf(step);
  const next = () => setStep(steps[Math.min(at + 1, steps.length - 1)]);
  const finish = () => void api.setupDone();

  // The first save, made from the "Try it" step: a moment to enjoy it, then out of the way.
  useEffect(() => {
    if (step !== 'try') return;
    return api.onJobsChanged(() =>
      void api.listJobs().then((jobs) => {
        if (!jobs.length) return;
        setSaved(true);
        setTimeout(finish, 2200);
      }),
    );
  }, [step]);

  const mood: Mood = saved ? 'happy' : step === 'hello' ? 'wide' : step === 'try' ? 'curious' : 'awake';
  if (!settings) return <div ref={fit} className="welcome" />;
  return (
    <div ref={fit} className="welcome drag">
      <div className="welcome-top">
        <motion.span key={mood} initial={{ scale: 0.9, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', duration: 0.45, bounce: 0.35 }}>
          <FolderMark size={step === 'hello' ? 64 : 40} alive mood={mood} />
        </motion.span>
        <div className="welcome-dots" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={s} className={`welcome-dot ${i === at ? 'on' : i < at ? 'done' : ''}`} />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} className="welcome-step" {...slide}>
          {step === 'hello' && (
            <>
              <h1 className="welcome-title">Hi, I’m Stashd.</h1>
              <p className="welcome-sub">I remember where you left off, so you can close everything and get right back to it later.</p>
              <div className="welcome-how">
                <Row k={<Kbd>{prettyShortcut(settings.shortcutSave)}</Kbd>} t="Stash" d="Save the tabs, files and apps you’re working on into a folder." />
                <Row k={<span className="welcome-chip">Pack up</span>} t="Close it all" d="Everything flies into the menu bar. Your desk is clear." />
                <Row k={<span className="welcome-chip">Unpack</span>} t="Pick it back up" d="It all comes back, with a note on where you were." />
              </div>
              <Actions primary="Let’s set it up" onPrimary={next} secondary="Skip setup" onSecondary={finish} />
            </>
          )}

          {step === 'access' && (
            <>
              <h1 className="welcome-title">Let me see your work</h1>
              <p className="welcome-sub">macOS asks once for each app. I only read what’s open: tab addresses and file names. Never what’s on the page, your passwords or private windows.</p>
              <Access items={items} onFix={refresh} />
              <Actions
                primary={asking ? 'Waiting for you…' : items?.some((i) => i.kind === 'automation' && i.status === 'ask') ? 'Allow all' : 'Continue'}
                busy={asking}
                onPrimary={async () => {
                  if (items?.some((i) => i.kind === 'automation' && i.status === 'ask')) await allow();
                  else next();
                }}
                secondary={items?.some((i) => i.status === 'ask') ? 'Later' : undefined}
                onSecondary={next}
              />
              {asking && <p className="welcome-note">Click <b>Allow</b> in each box macOS shows you.</p>}
            </>
          )}

          {step === 'ai' && (
            <>
              <h1 className="welcome-title">Want smarter notes?</h1>
              <p className="welcome-sub">When you stash, I write a short note on where you left off. Stashd AI makes those notes and your folder names much better. It’s free, with a daily limit.</p>
              <div className="welcome-box">
                <b>What it sends</b>
                <span>The names and titles of what you stash, web addresses with secrets removed, and your own note. Never what’s inside your files. It goes to Stashd’s server and on to Claude, made by Anthropic, and nothing is kept.</span>
              </div>
              <Actions
                primary="Turn on Stashd AI"
                onPrimary={() => void api.updateSettings({ stashdAi: true }).then(next)}
                secondary="Not now"
                onSecondary={() => void api.updateSettings({ stashdAi: false }).then(next)}
              />
              <p className="welcome-note">You can change this any time in Settings.</p>
            </>
          )}

          {step === 'chrome' && (
            <>
              <h1 className="welcome-title">One more thing for Chrome</h1>
              <p className="welcome-sub">A small Chrome helper puts each folder’s tabs in a tab group when you unpack, and remembers where you were in videos.</p>
              <ol className="welcome-list">
                <li>Click <b>Show me</b>: Chrome opens its extensions page and I show you a folder.</li>
                <li>Turn on <b>Developer mode</b> (top right).</li>
                <li>Click <b>Load unpacked</b> and pick that folder.</li>
              </ol>
              <Actions primary="Show me" onPrimary={() => void api.setupChromeGroups()} secondary="Done" onSecondary={next} />
            </>
          )}

          {step === 'try' && (
            <>
              <h1 className="welcome-title">{saved ? 'Your first folder is saved!' : 'Now try it'}</h1>
              {saved ? (
                <p className="welcome-sub">It’s in the menu bar. Press Pack up whenever you want your desk clear.</p>
              ) : (
                <>
                  <p className="welcome-sub">Open a few tabs or files for something you’re working on, then press</p>
                  <div className="welcome-big-key">
                    <Kbd>{prettyShortcut(settings.shortcutSave)}</Kbd>
                  </div>
                  <p className="welcome-note">Stashd lives in the menu bar, up top. Click its folder any time.</p>
                  <Actions primary="I’ll do it later" onPrimary={finish} />
                </>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Row({ k, t, d }: { k: React.ReactNode; t: string; d: string }) {
  return (
    <div className="welcome-row">
      <span className="welcome-key">{k}</span>
      <span>
        <b>{t}</b>
        <span className="welcome-d">{d}</span>
      </span>
    </div>
  );
}

function Actions(props: { primary: string; onPrimary: () => void; busy?: boolean; secondary?: string; onSecondary?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !props.busy && !(e.target as HTMLElement | null)?.closest('button')) props.onPrimary();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="welcome-actions no-drag">
      {props.secondary ? (
        <Button variant="ghost" onClick={props.onSecondary}>
          {props.secondary}
        </Button>
      ) : (
        <span />
      )}
      <Button variant="primary" disabled={props.busy} onClick={props.onPrimary}>
        {props.primary}
      </Button>
    </div>
  );
}

const STATUS: Record<SetupItem['status'], string> = { allowed: 'Allowed', denied: 'Turned off', ask: 'Not yet', later: 'When you open it' };

function Access({ items, onFix }: { items: SetupItem[] | null; onFix: () => void }) {
  if (!items) return <div className="welcome-apps loading">Looking at your apps…</div>;
  if (!items.length) return <div className="welcome-apps loading">Nothing to allow yet. I’ll ask when you first use an app.</div>;
  // Apps that aren't open can't be asked yet: one line for all of them, so the list shows what needs you.
  const now = items.filter((i) => i.status !== 'later');
  const later = items.filter((i) => i.status === 'later').map((i) => i.name);
  const names = later.length > 3 ? `${later.slice(0, 3).join(', ')} and ${later.length - 3} more` : later.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return (
    <div className="welcome-apps no-drag">
      {now.map((i) => (
        <div key={i.id} className={`welcome-app ${i.status}`}>
          <span className="welcome-app-dot" aria-hidden />
          <span className="welcome-app-text">
            <b>{i.name}</b>
            <span>{i.why}</span>
          </span>
          {i.status === 'denied' ? (
            <Button size="small" onClick={() => void api.openAutomationSettings().then(onFix)}>
              Turn on
            </Button>
          ) : i.kind === 'accessibility' && i.status === 'ask' ? (
            <Button size="small" onClick={() => void api.setupAccessibility().then(onFix)}>
              Allow
            </Button>
          ) : (
            <span className="welcome-app-status">{STATUS[i.status]}</span>
          )}
        </div>
      ))}
      {later.length > 0 && (
        <div className="welcome-app later">
          <span className="welcome-app-dot" aria-hidden />
          <span className="welcome-app-text">
            <b>{names}</b>
            <span className="wrap">Not open right now. I’ll ask the first time you use {later.length === 1 ? 'it' : 'them'}.</span>
          </span>
        </div>
      )}
    </div>
  );
}
