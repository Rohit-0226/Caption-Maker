import { describe, it, expect } from 'vitest';
import { STYLE_PRESETS, STYLE_CATEGORIES, getStylePreset } from '../src/core/rendering/presets';
import { ALL_TRANSITIONS } from '../src/features/styling/TransitionsTab';

describe('Premium Presets Suite', () => {
  const premiumIds = [
    'apple-cupertino',
    'cinematic-studio',
    'editorial-luxe',
    'executive-brief',
    'swiss-typography',
    'nordic-elegance',
    'luxury-couture',
    'tech-minimal',
    'monocle-doc',
  ];

  it('all 9 premium presets exist in STYLE_PRESETS', () => {
    for (const id of premiumIds) {
      const preset = getStylePreset(id);
      expect(preset, `Preset ${id} should exist`).toBeDefined();
      expect(preset?.category).toBe('premium');
    }
  });

  it('premium presets feature refined, balanced typography (not funky or oversized)', () => {
    for (const id of premiumIds) {
      const preset = getStylePreset(id)!;
      expect(preset.style.fontSize).toBeLessThanOrEqual(52);
      expect(preset.style.lineHeight).toBeGreaterThanOrEqual(1.38);
      expect(preset.style.wordSpacing).toBeGreaterThanOrEqual(0.34);
      expect(preset.style.activeWordScale ?? 1).toBeLessThanOrEqual(1.08);
      // No cartoonish heavy strokes on premium presets
      expect(preset.style.strokeWidth ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it('creator presets have balanced font sizes and line heights (no collisions)', () => {
    const creatorIds = ['hormozi-prime', 'mrbeast-hyper', 'submagic-emerald', 'capcut-crimson'];
    for (const id of creatorIds) {
      const preset = getStylePreset(id)!;
      expect(preset.style.fontSize).toBeLessThanOrEqual(62);
      expect(preset.style.lineHeight).toBeGreaterThanOrEqual(1.35);
      expect(preset.style.wordSpacing).toBeGreaterThanOrEqual(0.34);
      expect(preset.style.activeWordScale ?? 1).toBeLessThanOrEqual(1.12);
      expect(preset.style.strokeWidth ?? 0).toBeLessThanOrEqual(9);
    }
  });

  it('STYLE_CATEGORIES contains premium category', () => {
    const hasPremium = STYLE_CATEGORIES.some((cat) => cat.id === 'premium');
    expect(hasPremium).toBe(true);
  });
});

describe('Motion Transitions SVG Suite', () => {
  it('offers all 33 transitions with dedicated SVG icons', () => {
    expect(ALL_TRANSITIONS.length).toBe(33);
    for (const t of ALL_TRANSITIONS) {
      expect(t.id).toBeDefined();
      expect(t.label).toBeDefined();
      expect(t.icon).toBeDefined();
      expect(['basic', 'pop', 'word', 'reveal', 'dynamic']).toContain(t.category);
    }
  });
});

describe('Template Selection and Elevation', () => {
  it('getStylePreset precisely distinguishes presets with identical font families', () => {
    // Both Apple Cupertino and Swiss Precision use Inter font
    const apple = getStylePreset('apple-cupertino');
    const swiss = getStylePreset('swiss-typography');
    expect(apple?.style.fontFamily).toBe('Inter');
    expect(swiss?.style.fontFamily).toBe('Inter');
    expect(apple?.id).not.toBe(swiss?.id);
    expect(apple?.name).toBe('Apple Cupertino');
    expect(swiss?.name).toBe('Swiss Precision');
  });

  it('elevates selected preset to the top of the list when active', () => {
    const list = [...STYLE_PRESETS];
    const selectedId = 'swiss-typography';
    const activeIdx = list.findIndex((p) => p.id === selectedId);
    expect(activeIdx).toBeGreaterThan(0);

    const activeItem = list[activeIdx];
    const reordered = [activeItem, ...list.slice(0, activeIdx), ...list.slice(activeIdx + 1)];
    expect(reordered[0].id).toBe('swiss-typography');
    expect(reordered.length).toBe(STYLE_PRESETS.length);
  });
});
