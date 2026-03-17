'use client';

import Image from 'next/image';
import { startTransition, useEffect, useId, useState } from 'react';

type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
};

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

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

export function ImmersiveHomeHero() {
  const [activeIndex, setActiveIndex] = useState(INITIAL_INDEX);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPromptEvent | null>(null);
  const [isInstallSheetOpen, setIsInstallSheetOpen] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isIosLike, setIsIosLike] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const instructionsId = useId();

  const activeImage = HOME_HERO_IMAGES[activeIndex];
  const transitionDuration = prefersReducedMotion ? '100ms' : '1800ms';
  const transitionTimingFunction = 'cubic-bezier(.19,1,.22,1)';

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
    const userAgent = window.navigator.userAgent || '';
    const touchPoints = Number(window.navigator.maxTouchPoints || 0);
    const iosLike =
      /iPad|iPhone|iPod/i.test(userAgent) ||
      (userAgent.includes('Mac') && touchPoints > 1);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setIsIosLike(iosLike);
    setIsStandalone(standalone);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallShortcut = async () => {
    if (!installPrompt) return;

    try {
      setIsInstalling(true);
      await installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      setInstallPrompt(null);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <main
      aria-label="Galeria da home da QUEROBROA"
      aria-describedby={instructionsId}
      aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
      className="relative min-h-screen overflow-hidden bg-[#120c07] text-white"
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
        Foto {activeIndex + 1} de {HOME_HERO_IMAGES.length}
      </p>
      <div className="absolute inset-0">
        {HOME_HERO_IMAGES.map((image, index) => {
          const active = index === activeIndex;

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

        <div
          className="absolute inset-0 transition-[background]"
          style={{
            transitionDuration,
            transitionTimingFunction,
            background: `radial-gradient(circle at 18% 20%, ${activeImage.glow} 0%, transparent 30%), radial-gradient(circle at 82% 18%, ${activeImage.accent} 0%, transparent 24%), linear-gradient(90deg, rgba(15,9,4,0.68) 0%, rgba(15,9,4,0.28) 38%, rgba(15,9,4,0.16) 58%, rgba(15,9,4,0.62) 100%), linear-gradient(180deg, rgba(9,5,2,0.08) 0%, rgba(9,5,2,0.18) 38%, rgba(9,5,2,0.52) 74%, rgba(9,5,2,0.86) 100%)`
          }}
        />
      </div>

      <section className="relative z-10 flex min-h-screen flex-col justify-between px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10">
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
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/18 bg-[rgba(255,248,232,0.12)] px-6 text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-[rgba(255,248,232,0.94)] backdrop-blur-md transition-[background,border-color,transform] duration-300 ease-out hover:border-white/32 hover:bg-[rgba(255,248,232,0.18)] hover:translate-y-[-1px]"
            onClick={() => {
              if (isStandalone) {
                window.location.href = '/pedido';
                return;
              }
              setIsInstallSheetOpen(true);
            }}
            data-home-cta
            type="button"
          >
            {isStandalone ? 'Abrir pedido rapido' : 'Atalho no celular'}
          </button>
          <p className="max-w-[22rem] text-[0.8rem] leading-5 text-[rgba(255,248,232,0.78)] sm:ml-2">
            Salve um atalho para abrir `/pedido`, reaproveitar seus dados neste aparelho e refazer o ultimo pedido com 1 toque.
          </p>
        </div>
      </section>

      {isInstallSheetOpen ? (
        <div
          className="fixed inset-0 z-40 bg-[rgba(10,6,3,0.62)] px-4 py-6 backdrop-blur-sm sm:px-6"
          onClick={() => setIsInstallSheetOpen(false)}
        >
          <div className="mx-auto flex min-h-full max-w-md items-end sm:items-center">
            <div
              className="w-full rounded-[30px] border border-white/18 bg-[linear-gradient(180deg,rgba(28,17,10,0.96),rgba(19,11,6,0.98))] p-5 text-[rgba(255,248,232,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.36)] sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="brand-wordmark brand-wordmark--micro text-[0.8rem] text-[rgba(255,248,232,0.82)]">
                    @querobroa
                  </p>
                  <h2 className="mt-2 text-[1.35rem] font-semibold sm:text-[1.55rem]">
                    Pedido rapido no celular
                  </h2>
                </div>
                <button
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/8 text-lg text-[rgba(255,248,232,0.86)]"
                  onClick={() => setIsInstallSheetOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>

              <p className="mt-3 text-sm leading-6 text-[rgba(255,248,232,0.78)]">
                O atalho abre direto em `/pedido`. Neste aparelho, o sistema guarda seus dados e oferece um botao para refazer o ultimo pedido.
              </p>

              <div className="mt-5 grid gap-3 rounded-[24px] border border-white/10 bg-white/6 p-4 text-sm leading-6 text-[rgba(255,248,232,0.84)]">
                <p className="font-semibold text-[rgba(255,248,232,0.96)]">No iPhone</p>
                <p>1. Abra o Safari.</p>
                <p>2. Toque em Compartilhar.</p>
                <p>3. Escolha Adicionar a Tela de Inicio.</p>
              </div>

              {installPrompt && !isIosLike ? (
                <button
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-white/14 bg-[rgba(255,248,232,0.14)] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-[rgba(255,248,232,0.96)] transition hover:bg-[rgba(255,248,232,0.2)]"
                  disabled={isInstalling}
                  onClick={() => {
                    void handleInstallShortcut();
                  }}
                  type="button"
                >
                  {isInstalling ? 'Instalando...' : 'Instalar agora'}
                </button>
              ) : null}

              <a
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full border border-white/12 bg-[rgba(91,54,28,0.42)] px-6 text-sm font-semibold uppercase tracking-[0.16em] text-[rgba(255,248,232,0.96)] transition hover:bg-[rgba(91,54,28,0.56)]"
                href="/pedido"
              >
                Abrir pedido rapido
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
