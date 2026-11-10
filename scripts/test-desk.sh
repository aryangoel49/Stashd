#!/bin/bash
# A messy desk to try Tidy all by hand: seven pieces of work mixed with clutter, across three Chrome
# windows, Word and Finder.
#   bash scripts/test-desk.sh          open it all
#   bash scripts/test-desk.sh --close  close what's still open from it and delete its files (--clean works too)
#
# What Smart Tidy all should do: Stashd (into your Stashd folder if you have one), Toronto trip, Climate essay,
# Acme, New laptop, Learning Spanish and Marathon training each end up in a folder; the video goes on the
# Break shelf; the clutter (Reddit, YouTube home, Amazon, CNN, ESPN scores, a recipe, NASA "page not found" pages)
# closes without being saved.
# With Smart off: a Stashd folder you have open is saved, and everything else just closes.
DIR="$HOME/Documents/Stashd test desk"
IDS="$DIR/.chrome-windows"

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
  echo "Test desk closed and its files deleted."
  echo "The folders Tidy all made from it are still in Stashd: delete them there if you don't want them."
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
# Window 1: Stashd, the new laptop and Spanish, with clutter mixed in.
window \
  "https://github.com/aryangoel49/Stashd" \
  "https://www.reddit.com/r/aww/" \
  "https://www.apple.com/macbook-air/" \
  "https://github.com/aryangoel49/Stashd/releases" \
  "https://en.wikipedia.org/wiki/Spanish_verbs" \
  "https://www.youtube.com/" \
  "https://www.apple.com/mac/compare/" \
  "https://github.com/aryangoel49/Stashd/issues" \
  "https://www.spanishdict.com/guide/spanish-present-tense-forms" \
  "https://en.wikipedia.org/wiki/MacBook_Air_(Apple_silicon)"
# Window 2: the Toronto trip and the essay's research all mixed together, plus clutter.
window \
  "https://en.wikipedia.org/wiki/Toronto" \
  "https://en.wikipedia.org/wiki/Sea_level_rise" \
  "https://www.allrecipes.com/recipe/11973/spaghetti-italian/" \
  "https://www.booking.com/city/ca/toronto.html" \
  "https://science.nasa.gov/earth/explore/sea-level/" \
  "https://www.tripadvisor.ca/Attractions-g155019-Activities-Toronto_Ontario.html" \
  "https://www.amazon.ca/s?k=wireless+earbuds" \
  "https://en.wikipedia.org/wiki/CN_Tower" \
  "https://en.wikipedia.org/wiki/Effects_of_climate_change_on_oceans"
# Window 3: marathon training, Spanish, a video to finish later, and more clutter.
window \
  "https://www.halhigdon.com/training-programs/marathon-training/novice-1-marathon/" \
  "https://www.cnn.com/" \
  "https://en.wikipedia.org/wiki/Marathon" \
  "https://en.wikipedia.org/wiki/Spanish_grammar" \
  "https://www.youtube.com/watch?v=aqz-KE-bpKQ" \
  "https://www.espn.com/nba/scoreboard" \
  "https://en.wikipedia.org/wiki/Long_slow_distance" \
  "https://science.nasa.gov/this-page-does-not-exist/"

# Word: the essay and the two Acme documents. Finder: the Acme folder.
open -a "Microsoft Word" "$DIR/School/Climate essay.docx" "$DIR/Clients/Acme/Acme proposal.docx" "$DIR/Clients/Acme/Acme budget.docx"
open "$DIR/Clients/Acme"

echo "Test desk is open: 27 tabs in 3 Chrome windows, 3 Word documents and a Finder window."
echo "Wait about 10 seconds for the pages to load, then press Tidy all."
