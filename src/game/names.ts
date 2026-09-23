import type { Rng } from '../rng';
import type { LandmassKind } from './types';

const SAINTS = ['Brendan', 'Agatha', 'Elmo', 'Cyprian', 'Ursula', 'Anselm', 'Brigid', 'Columba', 'Hilda', 'Jerome', 'Lucia', 'Nicholas', 'Oswin', 'Petroc', 'Winifred'];
const ADJ = ['Barren', 'Green', 'Misty', 'Low', 'High', 'Black', 'Grey', 'Fair', 'Lonely', 'Windward', 'Leeward', 'Stormy', 'Silent', 'Golden', 'Pale'];
const NOUNS = ['Hope', 'Providence', 'Deliverance', 'Fortune', 'Mercy', 'Resolve', 'Constancy', 'Patience', 'Plenty', 'Sorrow'];
const PATRONS = ['Grenville', 'Hawkins', 'Frobisher', 'Carteret', 'Dampier', 'Vancourt', 'Ashby', 'Pellow', 'Merriwether', 'Tasker'];
const PORTS = ['Port Haven', 'Saltmarsh', 'Kingsquay', 'Harrowmouth', 'Brightwater'];

export function suggestName(rng: Rng, kind: LandmassKind, used: Set<string>): string {
  for (let attempt = 0; attempt < 30; attempt++) {
    const name = draw(rng, kind);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${draw(rng, kind)} ${used.size}`;
  used.add(fallback);
  return fallback;
}

function draw(rng: Rng, kind: LandmassKind): string {
  const form = rng.int(0, 3);
  switch (kind) {
    case 'islet':
      return form < 2 ? `${rng.pick(ADJ)} Rock` : `${rng.pick(SAINTS)}'s Key`;
    case 'island':
      if (form === 0) return `Isle of ${rng.pick(NOUNS)}`;
      if (form === 1) return `${rng.pick(ADJ)} Island`;
      return `Saint ${rng.pick(SAINTS)}'s Isle`;
    case 'large island':
      return form < 2 ? `${rng.pick(PATRONS)} Land` : `Great ${rng.pick(NOUNS)} Island`;
    case 'coast':
      return form < 2 ? `New ${rng.pick(PATRONS)}` : `${rng.pick(ADJ)} Coast`;
  }
}

export function portName(rng: Rng): string {
  return rng.pick(PORTS);
}

const FAR_PORTS = ['Saint Anselm', 'Porto Lume', 'Vareth', 'Bonaventure', 'Oster Quay'];
const POWERS = ['the Lusan Crown', 'the Valdran Company', 'the Free City of Oster', 'the Margravate of Hule'];

export function farPort(rng: Rng): { name: string; power: string } {
  return { name: rng.pick(FAR_PORTS), power: rng.pick(POWERS) };
}
