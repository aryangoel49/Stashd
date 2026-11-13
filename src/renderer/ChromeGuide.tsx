// The small card that stays beside Chrome while you add Stashd's Chrome helper (opened from the welcome
// or Settings). The steps stay on screen, the folder is dragged straight from here onto Chrome's
// extensions page (no file picker), and the card ticks itself off once Chrome starts talking to Stashd.

import { useEffect, useState } from 'react';
import { api, useFitWindow } from './api';
import { Icon } from './icons';
import { Button, FolderMark, motion } from './ui';

export function ChromeGuide() {
  const fit = useFitWindow<HTMLDivElement>();
  const [added, setAdded] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => api.onChromeHelperAdded(() => setAdded(true)), []);

  return (
    <div ref={fit} className="cg drag">
      <div className="cg-head">
        <FolderMark size={26} alive mood={added ? 'happy' : 'awake'} />
        <b>{added ? 'Added to Chrome' : 'Add Stashd to Chrome'}</b>
        <button type="button" className="cg-close no-drag" aria-label="Close" onClick={() => void api.closeWindow()}>
          ×
        </button>
      </div>

      {added ? (
        <motion.p className="cg-done" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}>
          All set. Each folder's tabs now sit in their own tab group, named after it.
        </motion.p>
      ) : (
        <ol className="cg-steps no-drag">
          <li>
            <span className="cg-n">1</span>
            <span>
              In Chrome, turn on <b>Developer mode</b>
              <span className="cg-hint">The switch at the top right of the page</span>
            </span>
          </li>
          <li className="cg-now">
            <span className="cg-n">2</span>
            <span>
              Drag this folder onto the Chrome page
              <span
                className="cg-folder"
                draggable
                onDragStart={(e) => {
                  e.preventDefault();
                  api.dragChromeHelper();
                }}
                title="Drag me onto Chrome's extensions page"
              >
                <Icon name="folder" />
                Stashd helper
                <span className="cg-arrow" aria-hidden="true">
                  ←
                </span>
              </span>
              <span className="cg-hint">
                Or click <b>Load unpacked</b>, press <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>G</kbd>, paste, then <b>Select</b>.{' '}
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    void api.copyChromeHelperPath().then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                >
                  {copied ? 'Copied' : 'Copy where it is'}
                </Button>
              </span>
            </span>
          </li>
          <li>
            <span className="cg-n">3</span>
            <span>
              That's it. This card ticks itself off
              <span className="cg-hint">It notices when Chrome adds the helper</span>
            </span>
          </li>
        </ol>
      )}
    </div>
  );
}
