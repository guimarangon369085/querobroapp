'use client';

import Image from 'next/image';
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

const AUTOPLAY_MS = 6000;
const INITIAL_INDEX = 4;
const HOME_PARALLAX_X_LIMIT = 16;
const HOME_PARALLAX_Y_LIMIT = 12;

type MotionPermissionState = 'idle' | 'pending' | 'granted' | 'denied' | 'unsupported';

type DeviceOrientationPermissionApi = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

function clampMotion(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ImmersiveHomeHero() {
  const [activeIndex, setActiveIndex] = useState(INITIAL_INDEX);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [motionPermissionState, setMotionPermissionState] = useState<MotionPermissionState>('idle');
  const instructionsId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const hasAttemptedMotionPermissionRef = useRef(false);

  const activeImage = HOME_HERO_IMAGES[activeIndex];
  const transitionDuration = prefersReducedMotion ? '100ms' : '1800ms';
  const transitionTimingFunction = 'cubic-bezier(.19,1,.22,1)';

  const applyParallax = useCallback((x: number, y: number) => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--home-parallax-x', `${x.toFixed(2)}px`);
    root.style.setProperty('--home-parallax-y', `${y.toFixed(2)}px`);
  }, []);

  const step = (delta = 1) => {
    startTransition(() => {
      setActiveIndex((current) => wrapIndex(current + delta, HOME_HERO_IMAGES.length));
    });
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const autoplay = window.setInterval(() => {
      step(1);
    }, AUTOPLAY_MS);

    return () => {
      window.clearInterval(autoplay);
    };
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setMotionPermissionState('unsupported');
      return;
    }

    const permissionApi = DeviceOrientationEvent as DeviceOrientationPermissionApi;
    if (typeof permissionApi.requestPermission === 'function') {
      setMotionPermissionState('idle');
      return;
    }

    setMotionPermissionState('granted');
  }, []);

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

  useEffect(() => {
    if (prefersReducedMotion || motionPermissionState !== 'granted') {
      applyParallax(0, 0);
      return;
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const gamma = typeof event.gamma === 'number' ? clampMotion(event.gamma, -22, 22) : 0;
      const beta = typeof event.beta === 'number' ? clampMotion(event.beta, -18, 18) : 0;
      const x = (gamma / 22) * HOME_PARALLAX_X_LIMIT;
      const y = (beta / 18) * HOME_PARALLAX_Y_LIMIT * -1;
      applyParallax(x, y);
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      applyParallax(0, 0);
    };
  }, [applyParallax, motionPermissionState, prefersReducedMotion]);

  const maybeEnableMotion = useCallback(() => {
    if (prefersReducedMotion) return;
    if (hasAttemptedMotionPermissionRef.current) return;
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;

    const permissionApi = DeviceOrientationEvent as DeviceOrientationPermissionApi;
    if (typeof permissionApi.requestPermission !== 'function') return;

    hasAttemptedMotionPermissionRef.current = true;
    setMotionPermissionState('pending');

    void permissionApi
      .requestPermission()
      .then((state) => {
        setMotionPermissionState(state === 'granted' ? 'granted' : 'denied');
      })
      .catch(() => {
        setMotionPermissionState('denied');
      });
  }, [prefersReducedMotion]);

  return (
    <main
      ref={rootRef}
      aria-label="Galeria da home da QUEROBROA"
      aria-describedby={instructionsId}
      aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
      className="fixed inset-0 overflow-hidden bg-[#120c07] text-white"
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100svh',
        minHeight: viewportHeight ? `${viewportHeight}px` : '100svh',
        ['--home-parallax-x' as string]: '0px',
        ['--home-parallax-y' as string]: '0px'
      }}
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a, [data-home-cta]')) return;
        maybeEnableMotion();
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
        Foto {activeIndex + 1} de {HOME_HERO_IMAGES.length}
      </p>
      <div className="absolute inset-0">
        {HOME_HERO_IMAGES.map((image, index) => {
          const active = index === activeIndex;
          const scale = active ? (prefersReducedMotion ? 1 : 1.02) : prefersReducedMotion ? 1 : 1.08;
          const translateX = active ? 'var(--home-parallax-x)' : 'calc(var(--home-parallax-x) * 1.55)';
          const translateY = active ? 'var(--home-parallax-y)' : 'calc(var(--home-parallax-y) * 1.55)';

          return (
            <div
              key={image.src}
              aria-hidden={!active}
              className={`absolute inset-[-3%] transition-[opacity,transform,filter] ${
                active ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
              style={{
                transform: `translate3d(${translateX}, ${translateY}, 0) scale(${scale})`,
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

        <div
          className="absolute inset-0 transition-[background,transform]"
          style={{
            transform:
              'translate3d(calc(var(--home-parallax-x) * -0.35), calc(var(--home-parallax-y) * -0.35), 0) scale(1.02)',
            transitionDuration,
            transitionTimingFunction,
            background: `radial-gradient(circle at 18% 20%, ${activeImage.glow} 0%, transparent 30%), radial-gradient(circle at 82% 18%, ${activeImage.accent} 0%, transparent 24%), linear-gradient(90deg, rgba(15,9,4,0.68) 0%, rgba(15,9,4,0.28) 38%, rgba(15,9,4,0.16) 58%, rgba(15,9,4,0.62) 100%), linear-gradient(180deg, rgba(9,5,2,0.08) 0%, rgba(9,5,2,0.18) 38%, rgba(9,5,2,0.52) 74%, rgba(9,5,2,0.86) 100%)`
          }}
        />
      </div>

      <section
        className="relative z-10 flex flex-col justify-between px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10"
        style={{
          height: viewportHeight ? `${viewportHeight}px` : '100svh',
          minHeight: viewportHeight ? `${viewportHeight}px` : '100svh'
        }}
      >
        <a
          className="brand-wordmark brand-wordmark--micro inline-flex w-fit items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.34)] px-4 py-2 text-[0.72rem] text-[rgba(255,248,232,0.92)] backdrop-blur-md transition-[background,border-color,transform] duration-500 ease-out hover:border-white/24 hover:bg-[rgba(26,15,8,0.48)] hover:translate-y-[-1px]"
          href="https://www.instagram.com/querobroa/"
          rel="noreferrer"
          target="_blank"
        >
          @querobroa
        </a>

        <div className="flex flex-col items-start gap-3 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:pb-6">
          <button
            aria-disabled="true"
            className="inline-flex min-h-12 cursor-not-allowed items-center justify-center rounded-full border border-white/12 bg-[rgba(56,34,14,0.26)] px-7 text-sm font-semibold uppercase tracking-[0.18em] text-[rgba(255,248,232,0.76)] backdrop-blur-md"
            data-home-cta
            disabled
            type="button"
          >
            Em breve
          </button>
        </div>
      </section>
    </main>
  );
}
