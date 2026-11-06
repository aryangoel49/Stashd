// What's open in the meaning model's scenarios (tests/meaning.test.ts, tests/chips.test.ts).

import type { Item } from '../src/shared/types';

export const tab = (url: string, title: string, window = 1): Item => ({ key: `tab:${url}`, kind: 'tab', label: title, detail: '', app: 'Google Chrome', url, browser: 'chrome', window });
export const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p });
export const app = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });
export const labels = (xs: Item[]) => xs.map((i) => i.label).sort();

// Soccer
export const streamKing = tab('https://streamking.cc/', 'StreamKing - Free NBA, NFL, NHL, MLB, Soccer Streams');
export const ovo = tab('https://www.google.com/search?q=ovo+goal', 'ovo goal - Google Search');
export const madrid = tab('https://totalsportek.pro/real-madrid', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek');
export const streamEast = tab('https://streameast.zip/', 'StreamEast.zip');
export const nba = tab('https://www.espn.com/nba', 'NBA Scores and Standings - ESPN', 8);
export const premier = tab('https://www.bbc.com/sport/football/tables', 'Premier League Table - BBC Sport', 8);
// AI research
export const aiDoc = doc('/Users/a/Documents/ai research.docx');
export const aiTab1 = tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 2);
export const nvidia = tab('https://www.nvidia.com/en-us/lp/ai/blueprint', 'Blueprint for AI Success eBook | Download & Build | NVIDIA', 2);
export const ml = tab('https://hbr.org/ml-workplace', 'How machine learning is changing the workplace | HBR', 3);
export const automation = tab('https://www.mckinsey.com/automation', 'Automation and the future of jobs | McKinsey', 3);
// Climate
export const essay = doc('/Users/a/Documents/School/Climate essay.docx');
export const jstor1 = tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR', 3);
export const jakarta = tab('https://www.bbc.com/news/1', 'Jakarta is sinking', 3);
export const glaciers = tab('https://www.nationalgeographic.com/glaciers', 'Why the glaciers are melting faster | National Geographic', 4);
// Toronto
export const flights = tab('https://www.expedia.ca/flights', 'Cheap Flights to Toronto | Expedia', 5);
export const cnTower = tab('https://www.cntower.ca/tickets', 'CN Tower Tickets', 6);
export const hotels = tab('https://www.booking.com/union-station', 'Hotels near Union Station', 6);
// Clutter
export const dogs = tab('https://www.reddit.com/r/aww', 'Cute dogs : aww', 9);
export const earbuds = tab('https://www.amazon.ca/x', 'Amazon.ca: Wireless Earbuds', 9);
export const linkedin = tab('https://www.linkedin.com/jobs', 'Jobs | LinkedIn', 9);
export const canva = tab('https://www.canva.com/design', 'Untitled design - Canva', 9);
export const quest = tab('https://www.uwaterloo.ca/quest', 'Quest - University of Waterloo', 9);
export const recipe = tab('https://www.allrecipes.com/pasta', 'Easy Weeknight Pasta Recipe | Allrecipes', 9);
export const preview = app('Preview');
export const textEdit = app('TextEdit');
export const clutter = [dogs, earbuds, linkedin, canva, quest, recipe];
