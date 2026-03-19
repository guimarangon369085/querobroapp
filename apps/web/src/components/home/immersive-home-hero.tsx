'use client';

import Image from 'next/image';
import Link from 'next/link';
import { startTransition, useCallback, useEffect, useId, useRef, useState } from 'react';

type HeroImage = {
  accent: string;
  alt: string;
  glow: string;
  id: number;
  src: string;
};

const TONES = [
  {
    accent: 'rgba(248, 197, 89, 0.2)',
    glow: 'rgba(255, 214, 120, 0.22)'
  },
  {
    accent: 'rgba(196, 64, 52, 0.18)',
    glow: 'rgba(228, 94, 79, 0.2)'
  },
  {
    accent: 'rgba(134, 166, 118, 0.18)',
    glow: 'rgba(174, 208, 153, 0.2)'
  },
  {
    accent: 'rgba(202, 94, 146, 0.18)',
    glow: 'rgba(238, 143, 188, 0.2)'
  },
  {
    accent: 'rgba(91, 121, 167, 0.18)',
    glow: 'rgba(121, 160, 219, 0.2)'
  },
  {
    accent: 'rgba(118, 77, 42, 0.2)',
    glow: 'rgba(162, 112, 70, 0.18)'
  }
] as const;

const HERO_IMAGE_COUNT = 9;

const HOME_HERO_IMAGES: HeroImage[] = Array.from({ length: HERO_IMAGE_COUNT }, (_, index) => {
  const imageId = index + 1;
  const tone = TONES[index % TONES.length];

  return {
    ...tone,
    id: imageId,
    alt: `Cena ${String(imageId).padStart(2, '0')} do acervo QUEROBROA`,
    src: `/querobroa-brand/home-immersive/scene-${String(imageId).padStart(2, '0')}.jpg`
  };
});

const MOBILE_AUTOPLAY_MS = 1000;
const DESKTOP_AUTOPLAY_MS = 6000;
const DESKTOP_STAGGER_MS = 340;
const INITIAL_INDEX = 4;
const DESKTOP_COLUMN_OFFSETS = [0, 3, 6] as const;

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

export function ImmersiveHomeHero() {
  const [mobileIndex, setMobileIndex] = useState(INITIAL_INDEX);
  const [desktopIndices, setDesktopIndices] = useState(() =>
    DESKTOP_COLUMN_OFFSETS.map((offset) => wrapIndex(INITIAL_INDEX + offset, HOME_HERO_IMAGES.length))
  );
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const instructionsId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const desktopShiftTimersRef = useRef<number[]>([]);

  const activeImage = HOME_HERO_IMAGES[desktopIndices[1] ?? mobileIndex];
  const transitionDuration = prefersReducedMotion ? '100ms' : isDesktopViewport ? '1800ms' : '720ms';
  const transitionTimingFunction = 'cubic-bezier(.19,1,.22,1)';
  const desktopColumnImages = desktopIndices.map((imageIndex, columnIndex) => ({
    imageIndex,
    image: HOME_HERO_IMAGES[imageIndex],
    columnIndex
  }));

  const clearDesktopShiftQueue = useCallback(() => {
    for (const timeoutId of desktopShiftTimersRef.current) {
      window.clearTimeout(timeoutId);
    }
    desktopShiftTimersRef.current = [];
  }, []);

  const queueDesktopShift = useCallback(
    (delta = 1) => {
      clearDesktopShiftQueue();
      desktopShiftTimersRef.current = DESKTOP_COLUMN_OFFSETS.map((_, columnIndex) =>
        window.setTimeout(() => {
          startTransition(() => {
            setDesktopIndices((current) =>
              current.map((value, index) =>
                index === columnIndex ? wrapIndex(value + delta, HOME_HERO_IMAGES.length) : value
              )
            );
          });
        }, prefersReducedMotion ? 0 : columnIndex * DESKTOP_STAGGER_MS)
      );
    },
    [clearDesktopShiftQueue, prefersReducedMotion]
  );

  const step = useCallback(
    (delta = 1) => {
      startTransition(() => {
        setMobileIndex((current) => wrapIndex(current + delta, HOME_HERO_IMAGES.length));
      });
      queueDesktopShift(delta);
    },
    [queueDesktopShift]
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktopViewport(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const autoplayMs = isDesktopViewport ? DESKTOP_AUTOPLAY_MS : MOBILE_AUTOPLAY_MS;
    const autoplay = window.setInterval(() => {
      step(1);
    }, autoplayMs);

    return () => {
      window.clearInterval(autoplay);
    };
  }, [isDesktopViewport, prefersReducedMotion, step]);

  useEffect(() => {
    return () => {
      clearDesktopShiftQueue();
    };
  }, [clearDesktopShiftQueue]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousRootHeight = root.style.height;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyHeight = body.style.height;
    const previousBodyPosition = body.style.position;
    const previousBodyInset = body.style.inset;
    const previousBodyWidth = body.style.width;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousBodyTouchAction = body.style.touchAction;

    const syncViewport = () => {
      const nextHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0);
      if (!nextHeight) return;
      setViewportHeight(nextHeight);
      root.style.overflow = 'hidden';
      root.style.height = `${nextHeight}px`;
      root.style.overscrollBehavior = 'none';
      body.style.overflow = 'hidden';
      body.style.height = `${nextHeight}px`;
      body.style.position = 'fixed';
      body.style.inset = '0';
      body.style.width = '100%';
      body.style.overscrollBehavior = 'none';
      body.style.touchAction = 'manipulation';
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);

    return () => {
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('scroll', syncViewport);
      root.style.overflow = previousRootOverflow;
      root.style.height = previousRootHeight;
      root.style.overscrollBehavior = previousRootOverscroll;
      body.style.overflow = previousBodyOverflow;
      body.style.height = previousBodyHeight;
      body.style.position = previousBodyPosition;
      body.style.inset = previousBodyInset;
      body.style.width = previousBodyWidth;
      body.style.overscrollBehavior = previousBodyOverscroll;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, []);

  return (
    <main
      ref={rootRef}
      aria-label="Galeria da home da QUEROBROA"
      aria-describedby={instructionsId}
      aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
      className="fixed inset-0 overflow-hidden bg-[#120c07] text-white"
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100svh',
        minHeight: viewportHeight ? `${viewportHeight}px` : '100svh'
      }}
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a, [data-home-cta]')) return;
        step(1);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          step(1);
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          step(-1);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          step(1);
        }
      }}
    >
      <p id={instructionsId} className="sr-only">
        Toque, clique ou use as setas do teclado para trocar a foto de fundo.
      </p>
      <p className="sr-only" aria-live="polite">
        Foto {mobileIndex + 1} de {HOME_HERO_IMAGES.length}
      </p>
      <div className="absolute inset-0">
        <div className="absolute inset-0 lg:hidden">
          {HOME_HERO_IMAGES.map((image, index) => {
            const active = index === mobileIndex;

            return (
              <div
                key={image.src}
                aria-hidden={!active}
                className={`absolute inset-[-3%] transition-[opacity,transform,filter] ${
                  active
                    ? `opacity-100 ${prefersReducedMotion ? 'scale-100' : 'scale-[1.02]'}`
                    : `pointer-events-none opacity-0 ${prefersReducedMotion ? 'scale-100' : 'scale-[1.08]'}`
                }`}
                style={{
                  transitionDuration,
                  transitionTimingFunction
                }}
              >
                <Image
                  alt={image.alt}
                  className="object-cover"
                  fill
                  priority={index === INITIAL_INDEX}
                  quality={86}
                  sizes="100vw"
                  src={image.src}
                />
              </div>
            );
          })}
        </div>

        <div className="absolute inset-0 hidden grid-cols-3 gap-[1.2vw] px-[1.2vw] py-[1.2vw] lg:grid">
          {desktopColumnImages.map(({ image, imageIndex, columnIndex }) => {
            const translateY = prefersReducedMotion ? 0 : (columnIndex - 1) * 18;
            const rotate = prefersReducedMotion ? 0 : (columnIndex - 1) * 1.35;
            const activeScale = prefersReducedMotion ? 1 : columnIndex === 1 ? 1.015 : 1.03;
            const inactiveScale = prefersReducedMotion ? 1 : activeScale + 0.045;
            const originX = columnIndex === 0 ? '18%' : columnIndex === 1 ? '50%' : '82%';
            const columnTransitionDuration = prefersReducedMotion
              ? '100ms'
              : `${1500 + columnIndex * 180}ms`;

            return (
              <div
                key={`desktop-column-${columnIndex}`}
                className="relative overflow-hidden rounded-[2.4vw] border border-white/10 bg-[rgba(17,10,6,0.28)] shadow-[0_24px_70px_rgba(8,5,2,0.28)]"
              >
                {HOME_HERO_IMAGES.map((columnImage, index) => {
                  const active = index === imageIndex;
                  const baseTransform = active
                    ? `translate3d(0, ${translateY}px, 0) rotate(${rotate}deg) scale(${activeScale})`
                    : `translate3d(0, ${translateY + (columnIndex === 1 ? 10 : 18)}px, 0) rotate(${rotate + (columnIndex === 1 ? 0 : columnIndex === 0 ? -0.4 : 0.4)}deg) scale(${inactiveScale})`;

                  return (
                    <div
                      key={`${columnIndex}-${columnImage.src}`}
                      aria-hidden={!active}
                      className={`absolute inset-0 transition-[opacity,transform,filter] ${
                        active
                          ? 'opacity-100'
                          : 'pointer-events-none opacity-0'
                      }`}
                      style={{
                        transform: baseTransform,
                        transformOrigin: `${originX} 52%`,
                        transitionDuration: columnTransitionDuration,
                        transitionTimingFunction
                      }}
                    >
                      <Image
                        alt={columnImage.alt}
                        className="object-cover"
                        fill
                        priority={columnIndex === 1 && index === imageIndex}
                        quality={86}
                        sizes="33vw"
                        src={columnImage.src}
                      />
                    </div>
                  );
                })}
                <div
                  className="absolute inset-0 transition-[background,opacity]"
                  style={{
                    transitionDuration: columnTransitionDuration,
                    transitionTimingFunction,
                    background:
                      columnIndex === 1
                        ? 'linear-gradient(180deg, rgba(7,5,3,0.04) 0%, rgba(7,5,3,0.14) 48%, rgba(7,5,3,0.4) 100%)'
                        : 'linear-gradient(180deg, rgba(7,5,3,0.06) 0%, rgba(7,5,3,0.2) 52%, rgba(7,5,3,0.48) 100%)'
                  }}
                />
                <div
                  className="absolute inset-0 opacity-90 mix-blend-screen"
                  style={{
                    background: `radial-gradient(circle at 50% 16%, ${image.glow} 0%, transparent 38%), radial-gradient(circle at 50% 88%, ${image.accent} 0%, transparent 34%)`
                  }}
                />
              </div>
            );
          })}
        </div>

        <div
          className="absolute inset-0 transition-[background]"
          style={{
            transitionDuration,
            transitionTimingFunction,
            background: `radial-gradient(circle at 18% 20%, ${activeImage.glow} 0%, transparent 30%), radial-gradient(circle at 82% 18%, ${activeImage.accent} 0%, transparent 24%), linear-gradient(90deg, rgba(15,9,4,0.46) 0%, rgba(15,9,4,0.16) 38%, rgba(15,9,4,0.08) 58%, rgba(15,9,4,0.34) 100%), linear-gradient(180deg, rgba(9,5,2,0.04) 0%, rgba(9,5,2,0.1) 38%, rgba(9,5,2,0.28) 74%, rgba(9,5,2,0.58) 100%)`
          }}
        />
        <div className="pointer-events-none absolute inset-y-0 left-1/3 hidden w-px -translate-x-1/2 bg-white/14 lg:block" />
        <div className="pointer-events-none absolute inset-y-0 left-2/3 hidden w-px -translate-x-1/2 bg-white/14 lg:block" />
      </div>

      <section
        className="relative z-10 flex flex-col justify-between px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10"
        style={{
          height: viewportHeight ? `${viewportHeight}px` : '100svh',
          minHeight: viewportHeight ? `${viewportHeight}px` : '100svh'
        }}
      >
        <a
          className="brand-wordmark brand-wordmark--micro inline-flex min-h-[2.55rem] w-fit items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.34)] px-6 py-0 text-[0.74rem] text-[rgba(255,248,232,0.92)] backdrop-blur-md transition-[background,border-color,transform] duration-500 ease-out hover:border-white/24 hover:bg-[rgba(26,15,8,0.48)] hover:translate-y-[-1px]"
          href="https://www.instagram.com/querobroa/"
          rel="noreferrer"
          target="_blank"
        >
          @querobroa
        </a>

        <div className="flex flex-col items-start gap-3 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:pb-6">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/14 bg-[rgba(56,34,14,0.42)] px-7 text-sm font-semibold uppercase tracking-[0.18em] text-[rgba(255,248,232,0.96)] backdrop-blur-md transition-[background,border-color,transform] duration-300 ease-out hover:border-white/24 hover:bg-[rgba(56,34,14,0.54)] hover:translate-y-[-1px]"
            data-home-cta
            href="/pedido"
          >
            Fazer pedido
          </Link>
        </div>
      </section>
    </main>
  );
}
