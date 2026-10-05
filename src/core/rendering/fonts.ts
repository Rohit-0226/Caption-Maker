export type FontCategory =
  | 'recommended'
  | 'bold'
  | 'clean'
  | 'condensed'
  | 'creator'
  | 'editorial'
  | 'fun'
  | 'devanagari'
  | 'system'
  | 'custom';

export interface FontDefinition {
  family: string;
  categories: FontCategory[];
  /** Google Fonts weights to request; system fonts ask for nothing. */
  weights: number[];
  source: 'google' | 'system' | 'custom';
  /** custom fonts only — where the server serves the file */
  url?: string;
}

/**
 * All Google Fonts below ship under the SIL Open Font License, which permits
 * bundling and embedding in rendered video. System fonts are used by name only,
 * never redistributed. No font file is copied from another application.
 */
export const FONT_CATALOGUE: FontDefinition[] = [
  // --- creator / bold / viral ----------------------------------------------
  { family: 'Anton', categories: ['recommended', 'bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Bebas Neue', categories: ['recommended', 'bold', 'condensed', 'creator'], weights: [400], source: 'google' },
  { family: 'Archivo Black', categories: ['recommended', 'bold', 'creator'], weights: [400], source: 'google' },
  { family: 'League Spartan', categories: ['recommended', 'bold', 'creator'], weights: [400, 700, 800, 900], source: 'google' },
  { family: 'Oswald', categories: ['bold', 'condensed', 'creator'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Barlow Condensed', categories: ['condensed', 'creator'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Roboto Condensed', categories: ['condensed', 'clean'], weights: [400, 500, 700], source: 'google' },
  { family: 'Saira Condensed', categories: ['condensed', 'bold', 'creator'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Kanit', categories: ['bold', 'creator'], weights: [400, 600, 700, 800, 900], source: 'google' },
  { family: 'Righteous', categories: ['bold', 'creator', 'fun'], weights: [400], source: 'google' },
  { family: 'Russo One', categories: ['bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Black Han Sans', categories: ['bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Passion One', categories: ['bold', 'creator'], weights: [400, 700, 900], source: 'google' },
  { family: 'Changa One', categories: ['bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Rowdy', categories: ['bold', 'creator'], weights: [400, 700], source: 'google' },
  { family: 'Paytone One', categories: ['bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Alfa Slab One', categories: ['bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Syne', categories: ['bold', 'creator', 'editorial'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Rubik', categories: ['bold', 'clean', 'creator'], weights: [400, 600, 700, 800, 900], source: 'google' },

  // --- modern / clean sans -------------------------------------------------
  { family: 'Inter', categories: ['recommended', 'clean'], weights: [400, 500, 600, 700, 800, 900], source: 'google' },
  { family: 'Poppins', categories: ['recommended', 'clean', 'creator'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Montserrat', categories: ['recommended', 'clean', 'bold', 'editorial'], weights: [400, 500, 600, 700, 800, 900], source: 'google' },
  { family: 'Manrope', categories: ['clean'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'DM Sans', categories: ['clean'], weights: [400, 500, 700], source: 'google' },
  { family: 'Space Grotesk', categories: ['clean', 'creator', 'editorial'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Outfit', categories: ['recommended', 'clean', 'creator'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Urbanist', categories: ['clean'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Plus Jakarta Sans', categories: ['recommended', 'clean', 'creator'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Quicksand', categories: ['recommended', 'clean', 'creator', 'bold'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Work Sans', categories: ['clean'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Figtree', categories: ['clean'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Sora', categories: ['clean', 'creator'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Raleway', categories: ['clean', 'editorial'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Nunito', categories: ['clean', 'fun'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Lexend', categories: ['clean'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Albert Sans', categories: ['clean'], weights: [400, 600, 700, 800], source: 'google' },

  // --- heavy / playful / fun -----------------------------------------------
  { family: 'Lilita One', categories: ['recommended', 'fun', 'bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Bangers', categories: ['fun', 'bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Luckiest Guy', categories: ['fun', 'bold', 'creator'], weights: [400], source: 'google' },
  { family: 'Fredoka', categories: ['fun', 'clean'], weights: [400, 600, 700], source: 'google' },
  { family: 'Titan One', categories: ['fun', 'bold'], weights: [400], source: 'google' },
  { family: 'Bungee', categories: ['fun', 'bold'], weights: [400], source: 'google' },
  { family: 'Chewy', categories: ['fun'], weights: [400], source: 'google' },
  { family: 'Comic Neue', categories: ['fun'], weights: [400, 700], source: 'google' },
  { family: 'Shrikhand', categories: ['fun', 'bold'], weights: [400], source: 'google' },

  // --- Devanagari / Hindi & Hinglish ---------------------------------------
  { family: 'Baloo 2', categories: ['recommended', 'devanagari', 'fun'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Teko', categories: ['recommended', 'devanagari', 'condensed', 'bold'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Mukta', categories: ['recommended', 'devanagari', 'clean'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Rajdhani', categories: ['recommended', 'devanagari', 'bold', 'creator'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Hind', categories: ['devanagari', 'clean'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Khand', categories: ['devanagari', 'condensed', 'bold'], weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Rozha One', categories: ['devanagari', 'editorial', 'bold'], weights: [400], source: 'google' },
  { family: 'Kalam', categories: ['devanagari', 'fun'], weights: [400, 700], source: 'google' },
  { family: 'Yatra One', categories: ['devanagari', 'bold'], weights: [400], source: 'google' },
  { family: 'Gotu', categories: ['devanagari', 'clean'], weights: [400], source: 'google' },
  { family: 'Noto Sans Devanagari', categories: ['devanagari', 'clean'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Noto Serif Devanagari', categories: ['devanagari', 'editorial'], weights: [400, 500, 600, 700], source: 'google' },

  // --- editorial / luxury --------------------------------------------------
  { family: 'Playfair Display', categories: ['editorial', 'creator'], weights: [400, 500, 600, 700, 800], source: 'google' },
  { family: 'Libre Baskerville', categories: ['editorial'], weights: [400, 700], source: 'google' },
  { family: 'Cinzel', categories: ['editorial', 'creator'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Cormorant Garamond', categories: ['editorial'], weights: [400, 600, 700], source: 'google' },
  { family: 'Fraunces', categories: ['editorial'], weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Prata', categories: ['editorial'], weights: [400], source: 'google' },
  { family: 'Bodoni Moda', categories: ['editorial'], weights: [400, 600, 700, 800], source: 'google' },

  // --- system / tech / monospace -------------------------------------------
  { family: 'Impact', categories: ['system', 'bold', 'creator'], weights: [400], source: 'system' },
  { family: 'Arial Black', categories: ['system', 'bold'], weights: [900], source: 'system' },
  { family: 'Segoe UI', categories: ['system', 'clean'], weights: [400, 600, 700], source: 'system' },
  { family: 'Georgia', categories: ['system', 'editorial'], weights: [400, 700], source: 'system' },
  { family: 'Verdana', categories: ['system', 'clean'], weights: [400, 700], source: 'system' },
  { family: 'Consolas', categories: ['system'], weights: [400, 700], source: 'system' },
  { family: 'Space Mono', categories: ['creator', 'clean'], weights: [400, 700], source: 'google' },
  { family: 'JetBrains Mono', categories: ['clean', 'creator'], weights: [400, 700, 800], source: 'google' },
];

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'bold', label: 'Bold' },
  { id: 'clean', label: 'Clean' },
  { id: 'condensed', label: 'Condensed' },
  { id: 'creator', label: 'Creator' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'fun', label: 'Fun' },
  { id: 'devanagari', label: 'Hindi' },
  { id: 'system', label: 'System' },
  { id: 'custom', label: 'Custom' },
];

// ---------------------------------------------------------------------------
// Lazy loading
// ---------------------------------------------------------------------------

const loaded = new Map<string, Promise<void>>();

const googleHref = (font: FontDefinition) => {
  const family = font.family.replace(/ /g, '+');
  const weights = font.weights.length > 0 ? `:wght@${font.weights.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${family}${weights}&display=swap`;
};

/**
 * Loads one font and resolves once the browser can actually paint with it.
 *
 * Nothing is fetched until something asks for it, so opening the app costs one
 * font rather than thirty. Repeat calls share the same promise.
 */
export const loadFont = (font: FontDefinition): Promise<void> => {
  const existing = loaded.get(font.family);
  if (existing) return existing;

  const promise = (async () => {
    if (font.source === 'system') return;

    if (typeof document === 'undefined') return;

    if (font.source === 'custom' && font.url) {
      const face = new FontFace(font.family, `url(${JSON.stringify(font.url)})`);
      const result = await face.load();
      document.fonts.add(result);
      return;
    }

    const href = googleHref(font);
    if (!document.querySelector(`link[data-font="${font.family}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.font = font.family;
      document.head.appendChild(link);
    }

    /**
     * Wait for every requested weight, not just one.
     *
     * A caption set to 800 gets no help from a loaded 700, and the fallback it
     * paints with meanwhile is a different size — so the preview would settle to
     * a size the export does not share.
     */
    const weights = font.weights.length ? font.weights : [400];
    await Promise.all(
      weights.map((weight) =>
        document.fonts.load(`${weight} 16px "${font.family}"`).catch(() => undefined),
      ),
    );
    await document.fonts.ready;
  })();

  loaded.set(font.family, promise);
  return promise;
};

export const findFont = (family: string, custom: FontDefinition[] = []) =>
  [...custom, ...FONT_CATALOGUE].find((f) => f.family === family);

export const loadFontFamily = (family: string, custom: FontDefinition[] = []) => {
  const font = findFont(family, custom);
  return font ? loadFont(font) : Promise.resolve();
};
