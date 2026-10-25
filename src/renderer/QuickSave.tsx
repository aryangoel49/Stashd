import { useEffect, useRef, useState } from 'react';
import type { ProjectListItem } from '../shared/types';
import { api, errorText } from './api';

export function QuickSave() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = async () => {
    setNote('');
    setState('idle');
    setError(null);
    const [list, suggested] = await Promise.all([api.listProjects(), api.suggestedProject()]);
    setProjects(list);
    setProjectId(suggested ?? list[0]?.id ?? '');
    setTimeout(() => input.current?.focus(), 0);
  };

  useEffect(() => {
    document.body.classList.add('quicksave');
    void reset().catch((e) => setError(errorText(e)));
    const off = api.onQuickSaveReset(() => void reset());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void api.closeWindow();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const save = async () => {
    if (!projectId || state !== 'idle') return;
    setState('saving');
    setError(null);
    try {
      await api.saveSnapshot(projectId, note);
      setState('done');
      setTimeout(() => void api.closeWindow(), 500);
    } catch (e) {
      setState('idle');
      setError(errorText(e));
    }
  };

  if (state === 'done') return <div className="qs-done drag">Saved ✓</div>;

  return (
    <form
      className="qs drag"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="qs-title">Save where I am</div>
      {projects && projects.length === 0 ? (
        <>
          <p className="muted">Add a project folder first, then come back here.</p>
          <div className="qs-foot no-drag">
            <span>
              <kbd>Esc</kbd> to cancel
            </span>
            <button type="button" className="primary" onClick={() => void api.openWindow('settings').then(() => api.closeWindow())}>
              Open Settings
            </button>
          </div>
        </>
      ) : (
        <>
          <select className="no-drag" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            ref={input}
            className="no-drag"
            type="text"
            value={note}
            maxLength={2000}
            placeholder="What were you about to do next?"
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          {error && <div className="banner error no-drag">{error}</div>}
          <div className="qs-foot no-drag">
            <span>
              <kbd>Enter</kbd> to save, <kbd>Esc</kbd> to cancel
            </span>
            <button type="submit" className="primary" disabled={!projectId || state === 'saving'}>
              {state === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
