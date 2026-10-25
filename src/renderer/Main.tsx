// The app window. Phase 5 turns this into the full jobs, history and settings window.

import { useSettings } from './api';

export function Main() {
  useSettings();
  return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <div className="display">All jobs</div>
      <p>Coming soon. For now, use the menu bar icon.</p>
    </div>
  );
}
