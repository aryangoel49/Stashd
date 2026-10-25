// The Claude models offered in Settings. Costs are rough, for one brief (about 1,500 words in, a short answer out).

export interface ClaudeModel {
  id: string;
  name: string;
  blurb: string;
  cost: string;
  /** Slower models get more time before we give up and use the next brief writer. */
  slow: boolean;
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', blurb: 'Fast and cheapest. Plenty for briefs.', cost: 'about $0.0004 a brief', slow: false },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', blurb: 'Smarter at spotting how things connect.', cost: 'about $0.008 a brief', slow: true },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', blurb: 'Very smart, a few seconds slower.', cost: 'about $0.02 a brief', slow: true },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', blurb: "Anthropic's most capable. Slowest and priciest.", cost: 'about $0.05 a brief', slow: true },
];

export function modelInfo(id: string): ClaudeModel | null {
  return CLAUDE_MODELS.find((m) => m.id === id) ?? null;
}
