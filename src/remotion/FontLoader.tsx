import React, { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import type { RenderFont } from '../core/types/project';

const cssFor = (font: RenderFont): string | null => {
  if (font.source === 'custom' && font.url) {
    return `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(
      font.url,
    )});font-display:block;}`;
  }
  return null;
};

const googleHref = (font: RenderFont): string | null => {
  if (font.source !== 'google') return null;
  const family = font.family.replace(/ /g, '+');
  const weights = font.weights?.length ? `:wght@${font.weights.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${family}${weights}&display=block`;
};

/** Every weight worth blocking on: the one in use first, then the rest. */
const weightsToLoad = (font: RenderFont): number[] => {
  const used = font.usedWeight ?? 400;
  const rest = (font.weights ?? []).filter((w) => w !== used);
  return [used, ...rest];
};

/**
 * Resolves once the browser has parsed a stylesheet, or immediately if it never
 * arrives.
 *
 * `document.fonts` only knows about faces the stylesheet has declared. Probing
 * before the CSS lands finds nothing to wait for, `document.fonts.ready`
 * resolves against an empty queue, and the render starts with no font loaded.
 */
const styleSheetReady = (link: HTMLLinkElement, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (link.sheet) return resolve();
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    window.setTimeout(done, timeoutMs);
  });

/**
 * Makes the caption font available before a frame is drawn.
 *
 * Rendering happens in headless Chrome, which starts with no fonts loaded, so
 * without this the exported video would fall back to a system face and stop
 * matching the editor. `delayRender` holds the frame until the face is ready.
 *
 * The weight matters as much as the family. A fallback face at the same
 * `font-size` occupies a different amount of space, so a caption drawn before
 * the real face arrives is visibly a different size from one drawn after — the
 * export ends up with captions that change size partway through.
 */
export const FontLoader: React.FC<{ fonts: RenderFont[] }> = ({ fonts }) => {
  const [handle] = useState(() =>
    fonts.length > 0 ? delayRender('Loading caption fonts') : null,
  );

  const faceCss = fonts.map(cssFor).filter(Boolean).join('\n');
  const links = fonts.map(googleHref).filter((href): href is string => Boolean(href));

  useEffect(() => {
    if (handle === null) return;

    let cancelled = false;

    const ready = async () => {
      try {
        // wait for the @font-face rules to exist before asking for their faces
        const pending = links.map((href) => {
          const link = document.querySelector<HTMLLinkElement>(
            `link[rel="stylesheet"][href="${href}"]`,
          );
          return link ? styleSheetReady(link, 10_000) : Promise.resolve();
        });
        await Promise.all(pending);

        for (const font of fonts) {
          if (font.source === 'system') continue;
          await Promise.all(
            weightsToLoad(font).map((weight) =>
              document.fonts
                .load(`${weight} 64px "${font.family}"`)
                .catch(() => undefined),
            ),
          );
        }

        await document.fonts.ready;
      } finally {
        // never strand the render: continue even if a face failed to load
        if (!cancelled) continueRender(handle);
      }
    };

    void ready();
    return () => {
      cancelled = true;
    };
    // links is derived from fonts, so fonts alone is the real dependency
  }, [handle, fonts]);

  return (
    <>
      {links.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {faceCss ? <style dangerouslySetInnerHTML={{ __html: faceCss }} /> : null}
    </>
  );
};
