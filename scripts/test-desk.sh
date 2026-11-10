#!/bin/bash
# Sets up a messy desk to try Tidy all's sorting by hand: four pieces of work (Stashd, a Toronto trip, a
# climate essay, an Acme client job) mixed with clutter, across two Chrome windows, Word and Finder.
#   bash scripts/test-desk.sh          open it all
#   bash scripts/test-desk.sh --clean  delete the test files afterwards
# What Tidy all should do: Stashd, Toronto, Climate essay and Acme each end up in a folder (an existing
# folder if you have one for it), and the clutter tabs close without being saved.
set -e
DIR="$HOME/Documents/Stashd test desk"

if [ "$1" = "--clean" ]; then
  rm -rf "$DIR"
  echo "Deleted $DIR. Delete the test folders in Stashd's Home yourself (Climate essay, Toronto, Acme)."
  exit 0
fi

mkdir -p "$DIR/School" "$DIR/Clients/Acme"
doc() { # doc <file.docx> <text>: a real Word document, made with macOS's own textutil
  printf '%s\n' "$2" > "$DIR/tmp.txt"
  textutil -convert docx "$DIR/tmp.txt" -output "$1"
  rm "$DIR/tmp.txt"
}
doc "$DIR/School/Climate essay.docx" "Climate essay. Sea level rise is already reshaping coastal cities. Draft, section 2: causes."
doc "$DIR/Clients/Acme/Acme proposal.docx" "Proposal for Acme Corp: website redesign, three phases."
doc "$DIR/Clients/Acme/Acme budget.docx" "Acme Corp budget: phase 1 design, phase 2 build, phase 3 launch."

# Word: the essay and the two Acme documents. Finder: the Acme folder.
open -a "Microsoft Word" "$DIR/School/Climate essay.docx" "$DIR/Clients/Acme/Acme proposal.docx" "$DIR/Clients/Acme/Acme budget.docx"
open "$DIR/Clients/Acme"

# Chrome window 1: Stashd work, with some clutter mixed in.
open -na "Google Chrome" --args --new-window \
  "https://github.com/aryangoel49/Stashd" \
  "https://www.reddit.com/r/aww/" \
  "https://github.com/aryangoel49/Stashd/releases" \
  "https://github.com/aryangoel49/Stashd/issues" \
  "https://www.youtube.com/"
sleep 2
# Chrome window 2: the trip and the essay's research all mixed together, plus clutter.
open -na "Google Chrome" --args --new-window \
  "https://en.wikipedia.org/wiki/Toronto" \
  "https://en.wikipedia.org/wiki/Sea_level_rise" \
  "https://www.allrecipes.com/recipe/11973/spaghetti-italian/" \
  "https://www.booking.com/city/ca/toronto.html" \
  "https://science.nasa.gov/earth/explore/sea-level/" \
  "https://www.tripadvisor.ca/Attractions-g155019-Activities-Toronto_Ontario.html" \
  "https://www.amazon.ca/s?k=wireless+earbuds" \
  "https://en.wikipedia.org/wiki/Effects_of_climate_change_on_oceans"

echo "Test desk is open. Wait about 10 seconds for the pages to load, then press Tidy all."
