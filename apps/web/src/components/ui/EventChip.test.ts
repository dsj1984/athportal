// apps/web/src/components/ui/EventChip.test.ts
//
// Unit tests for the EventChip composite primitive's pure-TS view
// builder. Covers the canonical event_type colour map, the inset
// stripe composition, conflict-dot gating, and defensive input
// handling. The `.astro` sibling is a thin renderer that consumes the
// builder's output verbatim — testing the builder pins both surfaces.
//
// Story #712 / Task #726.
import { describe, expect, it } from 'vitest';
import {
  EVENT_CHIP_CONFLICT_DOT_TEST_ID,
  EVENT_CHIP_TEST_ID,
  buildEventChipView,
} from './EventChip';
import { EVENT_COLORS, type EventType } from './_lib/eventColors';

const ALL_TYPES: readonly EventType[] = [
  'game',
  'practice',
  'training',
  'academic',
  'tournament',
  'meeting',
  'other',
];

describe('buildEventChipView — canonical event_type colour map', () => {
  it('exposes a triple for every canonical event_type', () => {
    for (const type of ALL_TYPES) {
      const view = buildEventChipView({ type, title: 'Test event' });
      expect(view.colors).toEqual(EVENT_COLORS[type]);
    }
  });

  it('includes tournament in the canonical set (Epic #702 addition)', () => {
    const view = buildEventChipView({ type: 'tournament', title: 'Spring Cup' });
    expect(view.colors.bg).toBe('rgb(139 92 246 / 0.2)');
    expect(view.colors.text).toBe('#ddd6fe');
    expect(view.colors.border).toBe('rgb(139 92 246 / 0.4)');
  });

  it('throws TypeError for an unmapped event_type', () => {
    expect(() =>
      // @ts-expect-error — deliberate invalid type to exercise the throw branch.
      buildEventChipView({ type: 'birthday', title: 'oops' }),
    ).toThrow(TypeError);
  });
});

describe('buildEventChipView — inset 3px stripe composition', () => {
  it('encodes the inset stripe via box-shadow inset 3px 0 0 keyed to the type colour', () => {
    const view = buildEventChipView({ type: 'game', title: 'Varsity vs. Glenwood' });
    expect(view.rootStyle).toContain('box-shadow:inset 3px 0 0 #fda4af');
  });

  it('uses each type’s text colour as the stripe colour', () => {
    for (const type of ALL_TYPES) {
      const view = buildEventChipView({ type, title: 'x' });
      expect(view.rootStyle).toContain(`box-shadow:inset 3px 0 0 ${EVENT_COLORS[type].text}`);
    }
  });

  it('embeds the background, text colour, and border in the root style', () => {
    const view = buildEventChipView({ type: 'practice', title: 'Warmup' });
    expect(view.rootStyle).toContain('background-color:rgb(14 165 233 / 0.2)');
    expect(view.rootStyle).toContain('color:#bae6fd');
    expect(view.rootStyle).toContain('border:1px solid rgb(14 165 233 / 0.4)');
  });
});

describe('buildEventChipView — conflict dot gating', () => {
  it('omits the conflict-dot style when conflict is not supplied', () => {
    const view = buildEventChipView({ type: 'meeting', title: 'Standup' });
    expect(view.conflict).toBe(false);
    expect(view.conflictDotStyle).toBeNull();
  });

  it('omits the conflict-dot style when conflict is explicitly false', () => {
    const view = buildEventChipView({ type: 'meeting', title: 'Standup', conflict: false });
    expect(view.conflictDotStyle).toBeNull();
  });

  it('emits a 6px action-coral dot positioned top-right when conflict is true', () => {
    const view = buildEventChipView({
      type: 'tournament',
      title: 'Spring Cup',
      conflict: true,
    });
    expect(view.conflict).toBe(true);
    const style = view.conflictDotStyle ?? '';
    expect(style).toContain('background-color:var(--color-action-coral)');
    expect(style).toContain('width:6px');
    expect(style).toContain('height:6px');
    expect(style).toContain('border-radius:9999px');
    expect(style).toContain('position:absolute');
    expect(style).toContain('top:4px');
    expect(style).toContain('right:4px');
  });
});

describe('buildEventChipView — optional fields and testIds', () => {
  it('passes through time and team when provided', () => {
    const view = buildEventChipView({
      type: 'training',
      title: 'Strength block',
      time: '4:00 PM',
      team: 'Varsity',
    });
    expect(view.time).toBe('4:00 PM');
    expect(view.team).toBe('Varsity');
  });

  it('normalises whitespace-only optional fields to null', () => {
    const view = buildEventChipView({
      type: 'academic',
      title: 'Study hall',
      time: '   ',
      team: '',
    });
    expect(view.time).toBeNull();
    expect(view.team).toBeNull();
  });

  it('exposes the canonical data-testids by default', () => {
    const view = buildEventChipView({ type: 'other', title: 'Misc' });
    expect(view.testIds.root).toBe(EVENT_CHIP_TEST_ID);
    expect(view.testIds.root).toBe('event-chip');
    expect(view.testIds.conflictDot).toBe(EVENT_CHIP_CONFLICT_DOT_TEST_ID);
    expect(view.testIds.conflictDot).toBe('event-chip-conflict-dot');
  });

  it('allows the root testId to be overridden', () => {
    const view = buildEventChipView({
      type: 'other',
      title: 'Misc',
      testId: 'agenda-event-chip',
    });
    expect(view.testIds.root).toBe('agenda-event-chip');
  });

  it('trims the title and rejects empty/whitespace-only titles', () => {
    const trimmed = buildEventChipView({ type: 'game', title: '  Title  ' });
    expect(trimmed.title).toBe('Title');
    expect(() => buildEventChipView({ type: 'game', title: '' })).toThrow(TypeError);
    expect(() => buildEventChipView({ type: 'game', title: '   ' })).toThrow(TypeError);
  });
});
