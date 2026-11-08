// Stashd keeping itself up to date: a small line in the menu bar panel when a new version is ready, and
// the Updates section in Settings. The work is done in src/main/updater.ts.

import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/types';
import { api, timeAgo } from './api';
import { Button } from './ui';

export function useUpdate(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(null);
  useEffect(() => {
    void api.updateState().then(setS, () => undefined);
    return api.onUpdateChanged(setS);
  }, []);
  return s;
}

/** In the panel, only once a new version is downloaded and checked. */
export function UpdateBar() {
  const s = useUpdate();
  const [busy, setBusy] = useState(false);
  if (s?.status !== 'ready' || !s.available) return null;
  return (
    <div className="update-bar" role="status">
      <span className="update-dot" aria-hidden />
      <span className="update-text">
        <b>Stashd {s.available}</b> is ready
      </span>
      {s.canInstall ? (
        <Button
          size="small"
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api.restartToUpdate();
          }}
          title="Stashd closes, updates and opens again in a few seconds. Your folders stay as they are."
        >
          {busy ? 'Restarting…' : 'Restart to update'}
        </Button>
      ) : (
        <Button size="small" onClick={() => void api.openUpdatePage()} title="Stashd can't replace itself where it is, so download the new version">
          Download
        </Button>
      )}
    </div>
  );
}

/** The Updates section in Settings. */
export function UpdateRow() {
  const s = useUpdate();
  const [checking, setChecking] = useState(false);
  if (!s) return <p className="faint small">Updates work in the installed app.</p>;
  const line =
    s.status === 'ready'
      ? `Stashd ${s.available} is ready. It installs when Stashd next quits, or now:`
      : s.status === 'downloading'
        ? `Getting Stashd ${s.available}…`
        : s.status === 'checking' || checking
          ? 'Checking…'
          : s.status === 'error'
            ? `Couldn’t update: ${s.error ?? 'something went wrong'}`
            : `You have the latest version${s.checkedAt ? `, checked ${timeAgo(s.checkedAt)}` : ''}.`;
  return (
    <div className="srow">
      <span>
        Stashd {s.current}
        <span className="faint small" style={{ display: 'block' }}>
          {line}
        </span>
      </span>
      {s.status === 'ready' && s.canInstall ? (
        <Button size="small" variant="primary" onClick={() => void api.restartToUpdate()}>
          Restart to update
        </Button>
      ) : s.status === 'ready' ? (
        <Button size="small" onClick={() => void api.openUpdatePage()}>
          Download
        </Button>
      ) : (
        <Button
          size="small"
          disabled={checking || s.status === 'downloading'}
          onClick={() => {
            setChecking(true);
            void api.checkForUpdate().finally(() => setChecking(false));
          }}
        >
          Check now
        </Button>
      )}
    </div>
  );
}
