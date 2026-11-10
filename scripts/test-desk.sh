#!/bin/bash
# A messy desk to try Tidy all by hand: seven pieces of work mixed with clutter, across three Chrome
# windows, Word and Finder.
#   bash scripts/test-desk.sh          open it all
#   bash scripts/test-desk.sh --close  close what's still open from it, delete its files, and make Stashd
#                                      forget it (--clean works too)
#
# What Smart Tidy all should do: Stashd (into your Stashd folder if you have one), Toronto trip, Climate essay,
# Acme, New laptop, Learning Spanish and Marathon training each end up in a folder; the video goes on the
# Break shelf; the clutter (Reddit, YouTube home, Amazon, CNN, ESPN scores, a recipe, NASA "page not found"
# pages) closes without being saved.
# With Smart off: a Stashd folder you have open is saved, and everything else just closes.
DIR="$HOME/Documents/Stashd test desk"
IDS="$DIR/.chrome-windows"
DATA="$HOME/Library/Application Support/Stashd"

# Window 1: Stashd, the new laptop and Spanish, with clutter mixed in.
WIN1=(
  "https://github.com/aryangoel49/Stashd"
  "https://www.reddit.com/r/aww/"
  "https://www.apple.com/macbook-air/"
  "https://github.com/aryangoel49/Stashd/releases"
  "https://en.wikipedia.org/wiki/Spanish_verbs"
  "https://www.youtube.com/"
  "https://www.apple.com/mac/compare/"
  "https://github.com/aryangoel49/Stashd/issues"
  "https://www.spanishdict.com/guide/spanish-present-tense-forms"
  "https://en.wikipedia.org/wiki/MacBook_Air_(Apple_silicon)"
)
# Window 2: the Toronto trip and the essay's research all mixed together, plus clutter.
WIN2=(
  "https://en.wikipedia.org/wiki/Toronto"
  "https://en.wikipedia.org/wiki/Sea_level_rise"
  "https://www.allrecipes.com/recipe/11973/spaghetti-italian/"
  "https://www.booking.com/city/ca/toronto.html"
  "https://science.nasa.gov/earth/explore/sea-level/"
  "https://www.tripadvisor.ca/Attractions-g155019-Activities-Toronto_Ontario.html"
  "https://www.amazon.ca/s?k=wireless+earbuds"
  "https://en.wikipedia.org/wiki/CN_Tower"
  "https://en.wikipedia.org/wiki/Effects_of_climate_change_on_oceans"
)
# Window 3: marathon training, Spanish, a video to finish later, and more clutter.
WIN3=(
  "https://www.halhigdon.com/training-programs/marathon-training/novice-1-marathon/"
  "https://www.cnn.com/"
  "https://en.wikipedia.org/wiki/Marathon"
  "https://en.wikipedia.org/wiki/Spanish_grammar"
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
  "https://www.espn.com/nba/scoreboard"
  "https://en.wikipedia.org/wiki/Long_slow_distance"
  "https://science.nasa.gov/this-page-does-not-exist/"
)

if [ "$1" = "--close" ] || [ "$1" = "--clean" ]; then
  # The Chrome windows it opened (the ones still there).
  if [ -f "$IDS" ]; then
    while read -r id; do
      [ -n "$id" ] && osascript -e "tell application \"Google Chrome\" to close (every window whose id is $id)" >/dev/null 2>&1
    done < "$IDS"
  fi
  # Its Word documents (without saving) and its Finder window.
  if pgrep -xq "Microsoft Word"; then
    for d in "Climate essay.docx" "Acme proposal.docx" "Acme budget.docx"; do
      osascript -e "tell application \"Microsoft Word\" to close document \"$d\" saving no" >/dev/null 2>&1
    done
  fi
  osascript -e 'tell application "Finder" to close (every window whose name is "Acme")' >/dev/null 2>&1
  rm -rf "$DIR"

  # Stashd forgets it: folders made only of test-desk things (with their backups and memory), and test-desk
  # things on the Break shelf, in Recently closed and in what other folders learned. Your own folders stay,
  # even ones Tidy all added test tabs to. Stashd is quit first so it doesn't write over the cleanup.
  if [ -d "$DATA/jobs" ]; then
    running=0
    APP="Stashd.app/Contents/MacOS/"
    if pgrep -fq "$APP"; then
      running=1
      osascript -e 'tell application "Stashd" to quit' >/dev/null 2>&1
      for _ in $(seq 1 20); do pgrep -fq "$APP" || break; sleep 0.5; done
      pkill -f "$APP" 2>/dev/null
      for _ in $(seq 1 20); do pgrep -fq "$APP" || break; sleep 0.5; done
    fi
    python3 - "$DATA" "$DIR" "${WIN1[@]}" "${WIN2[@]}" "${WIN3[@]}" <<'PYTHON'
import glob, json, os, shutil, sqlite3, sys

data, desk_dir, urls = sys.argv[1], sys.argv[2], sys.argv[3:]
norm = lambda u: u.split('://', 1)[-1].removeprefix('www.').rstrip('/')
desk_urls = {norm(u) for u in urls}
# Stashd drops search words from addresses it keeps (amazon.ca/s?k=... is kept as amazon.ca/s), except a video's id.
desk_urls |= {norm(u.split('?')[0]) for u in urls if '/watch?' not in u}

def from_desk(item):
    if item.get('url'):
        return norm(item['url']) in desk_urls
    return bool(item.get('path')) and item['path'].startswith(desk_dir + '/')

def desk_key(key):
    kind, _, rest = key.partition(':')
    return from_desk({'url': rest} if kind == 'tab' else {'path': rest})

def load(path, fallback=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback

def save(path, value):
    with open(path, 'w') as f:
        json.dump(value, f, indent=2)

gone = []
for job_dir in sorted(glob.glob(os.path.join(data, 'jobs', '*', ''))):
    job = load(os.path.join(job_dir, 'job.json'))
    if not job:
        continue
    things = [i for f in glob.glob(os.path.join(job_dir, 'history', '*.json')) for i in (load(f, {}) or {}).get('items', []) if i.get('kind') != 'app']
    if things and all(from_desk(i) for i in things):
        shutil.rmtree(job_dir, ignore_errors=True)
        for b in glob.glob(os.path.join(data, 'backups', '*', 'jobs', os.path.basename(job_dir.rstrip('/')))):
            shutil.rmtree(b, ignore_errors=True)
        gone.append((job['id'], job.get('name', job['id'])))
    else:
        # A folder of yours: forget only what it learned about test-desk things.
        prefs = job.get('prefs') or {}
        changed = False
        for k, v in prefs.items():
            if isinstance(v, dict):
                keep = {key: n for key, n in v.items() if not desk_key(key)}
                changed |= len(keep) != len(v)
                prefs[k] = keep
        if changed:
            save(os.path.join(job_dir, 'job.json'), job)

ids = [i for i, _ in gone]
db = os.path.join(data, 'memory.db')
if ids and os.path.exists(db):
    con = sqlite3.connect(db)
    for f in ids:
        con.execute('DELETE FROM snapshot_items WHERE folder_guess = ?', (f,))
        con.execute('DELETE FROM saves WHERE folder = ?', (f,))
        con.execute('DELETE FROM moments WHERE from_folder = ? OR to_folder = ?', (f, f))
    con.commit()
    con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    con.close()

shelf_path = os.path.join(data, 'break.json')
shelf = load(shelf_path)
shelved = 0
if isinstance(shelf, dict) and isinstance(shelf.get('items'), list):
    keep = [i for i in shelf['items'] if not from_desk(i)]
    shelved = len(shelf['items']) - len(keep)
    if shelved:
        shelf['items'] = keep
        save(shelf_path, shelf)

state_path = os.path.join(data, 'state.json')
state = load(state_path)
if isinstance(state, dict):
    if state.get('currentJobId') in ids:
        state['currentJobId'] = None
    recent = state.get('recentTidy')
    if isinstance(recent, dict) and isinstance(recent.get('items'), list):
        recent['items'] = [i for i in recent['items'] if not from_desk(i)]
    save(state_path, state)

print('Stashd forgot the test desk:', ', '.join(n for _, n in gone) or 'no folders to remove', f'(and {shelved} from the Break shelf).' if shelved else '')
PYTHON
    [ "$running" = 1 ] && open -a Stashd
  fi
  echo "Test desk closed and its files deleted."
  exit 0
fi

set -e
mkdir -p "$DIR/School" "$DIR/Clients/Acme"
: > "$IDS"
doc() { # doc <file.docx> <text>: a real Word document, made with macOS's own textutil
  printf '%s\n' "$2" > "$DIR/tmp.txt"
  textutil -convert docx "$DIR/tmp.txt" -output "$1"
  rm "$DIR/tmp.txt"
}
doc "$DIR/School/Climate essay.docx" "Climate essay. Sea level rise is already reshaping coastal cities. Draft, section 2: causes."
doc "$DIR/Clients/Acme/Acme proposal.docx" "Proposal for Acme Corp: website redesign, three phases."
doc "$DIR/Clients/Acme/Acme budget.docx" "Acme Corp budget: phase 1 design, phase 2 build, phase 3 launch."

# window <url>...: a new Chrome window with these tabs; its id is kept so --close can close it.
window() {
  local list="" u
  for u in "$@"; do list="$list\"$u\", "; done
  osascript - "${list%, }" >> "$IDS" <<'APPLESCRIPT'
on run argv
  set urls to run script "{" & item 1 of argv & "}"
  tell application "Google Chrome"
    set w to make new window
    set URL of active tab of w to item 1 of urls
    repeat with u in rest of urls
      tell w to make new tab with properties {URL:u}
    end repeat
    return id of w
  end tell
end run
APPLESCRIPT
}

open -a "Google Chrome"
sleep 1
window "${WIN1[@]}"
window "${WIN2[@]}"
window "${WIN3[@]}"

# Word: the essay and the two Acme documents. Finder: the Acme folder.
open -a "Microsoft Word" "$DIR/School/Climate essay.docx" "$DIR/Clients/Acme/Acme proposal.docx" "$DIR/Clients/Acme/Acme budget.docx"
open "$DIR/Clients/Acme"

echo "Test desk is open: 27 tabs in 3 Chrome windows, 3 Word documents and a Finder window."
echo "Wait about 10 seconds for the pages to load, then press Tidy all."
