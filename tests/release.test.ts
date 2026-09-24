import { describe, expect, it } from 'vitest';
import { setSail } from '../src/game/economy';
import { currentHint, dismissHint, stopHints } from '../src/game/hints';
import { addWaypoint } from '../src/game/sea';
import { deserialize, newGame, serialize } from '../src/game/state';

describe('hints', () => {
  it('shows each hint once, at its moment', () => {
    const s = newGame('hints');
    expect(currentHint(s)?.id).toBe('port');
    dismissHint(s, 'port');
    expect(currentHint(s)).toBeNull();
    setSail(s);
    expect(currentHint(s)?.id).toBe('course');
    addWaypoint(s, s.ship.x + 10, s.ship.y);
    expect(currentHint(s)?.id).not.toBe('course');
    dismissHint(s, 'course');
    expect(s.hintsSeen).toEqual(['port', 'course']);
  });

  it('stops for good when turned off, and survives a save', () => {
    const s = newGame('hints-off');
    stopHints(s);
    expect(currentHint(deserialize(serialize(s))!)).toBeNull();
  });

  it('stays quiet for captains whose saves predate hints', () => {
    const s = newGame('old-save');
    s.voyagesSailed = 3;
    delete s.hintsSeen;
    expect(deserialize(serialize(s))!.hintsOff).toBe(true);
  });
});

describe('damaged saves', () => {
  it('refuses text that is not a save', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{"version":3}')).toBeNull();
    expect(deserialize('{"version":99}')).toBeNull();
  });

  it('refuses a save with a truncated chart', () => {
    const s = newGame('damaged');
    const text = serialize(s).replace(/"known":\{"\$u8":\[[^\]]*\]\}/, '"known":{"$u8":[0,1]}');
    expect(deserialize(text)).toBeNull();
  });

  it('loads a whole save', () => {
    const s = newGame('whole');
    expect(deserialize(serialize(s))?.world.seed).toBe('whole');
  });
});
