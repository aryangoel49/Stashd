// The Apple Intelligence brief: runs on this Mac through the Swift helper. No internet.

import type { Brief, SaveEntry } from '../../shared/types';
import type { Helper } from '../helper';
import type { BriefWriter } from './index';
import { acceptAiBrief, extractJson } from './basic';
import { buildPromptData, INSTRUCTIONS } from './prompt';

const FORMAT = `
Answer with only a JSON object, nothing else: {"sentence": "...", "highlights": ["..."], "needed": ["i1"]}`;

export function appleWriter(helper: Helper, isAvailable: () => boolean): BriefWriter {
  return {
    name: 'apple',
    async write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null> {
      if (!isAvailable()) return null;
      const data = buildPromptData(entry, previous, feedback);
      const text = await helper.appleBrief(INSTRUCTIONS + FORMAT, JSON.stringify(data.payload));
      const brief = acceptAiBrief(extractJson(text), data.idToKey, 'apple', data.fallbackNeeded);
      if (!brief) throw new Error('Apple Intelligence sent back something unexpected.');
      return brief;
    },
  };
}
