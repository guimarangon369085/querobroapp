'use client';

import Image from 'next/image';
import Link from 'next/link';
import { startTransition, useEffect, useState } from 'react';

type HeroImage = {
  accent: string;
  alt: string;
  glow: string;
  id: number;
  objectPosition?: string;
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

const HOME_HERO_IMAGES: HeroImage[] = Array.from({ length: 21 }, (_, index) => {
  const imageId = index + 1;
  const tone = TONES[index % TONES.length];

  return {
    ...tone,
    id: imageId,
    alt: `Cena ${String(imageId).padStart(2, '0')} do acervo QUEROBROA`,
    objectPosition: imageId === 8 ? 'center 45%' : imageId === 10 ? 'center 40%' : 'center center',
    src: `/querobroa-brand/home-immersive/scene-${String(imageId).padStart(2, '0')}.jpg`
  };
});

const AUTOPLAY_MS = 6000;
const INITIAL_INDEX = 7;

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

export function ImmersiveHomeHero() {
  const [activeIndex, setActiveIndex] = useState(INITIAL_INDEX);

  const activeImage = HOME_HERO_IMAGES[activeIndex];

  const step = (delta = 1) => {
    startTransition(() => {
      setActiveIndex((current) => wrapIndex(current + delta, HOME_HERO_IMAGES.length));
    });
  };

  useEffect(() => {
    const autoplay = window.setInterval(() => {
      step(1);
    }, AUTOPLAY_MS);

    return () => {
      window.clearInterval(autoplay);
    };
  }, []);

  return (
    <main
      aria-label="Galeria da home da QUEROBROA"
      className="relative min-h-screen overflow-hidden bg-[#120c07] text-white"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) return;
        step(1);
      }}
    >
      <div className="absolute inset-0">
        {HOME_HERO_IMAGES.map((image, index) => {
          const active = index === activeIndex;

          return (
            <div
              key={image.src}
              aria-hidden={!active}
              className={`absolute inset-[-3%] transition-[opacity,transform,filter] duration-[1800ms] ease-[cubic-bezier(.19,1,.22,1)] ${
                active ? 'opacity-100 scale-[1.02]' : 'pointer-events-none opacity-0 scale-[1.08]'
              }`}
            >
              <Image
                alt={image.alt}
                className="object-cover"
                fill
                priority={index === INITIAL_INDEX}
                quality={86}
                sizes="100vw"
                src={image.src}
                style={{ objectPosition: image.objectPosition }}
              />
            </div>
          );
        })}

        <div
          className="absolute inset-0 transition-[background] duration-[1800ms] ease-[cubic-bezier(.19,1,.22,1)]"
          style={{
            background: `radial-gradient(circle at 18% 20%, ${activeImage.glow} 0%, transparent 30%), radial-gradient(circle at 82% 18%, ${activeImage.accent} 0%, transparent 24%), linear-gradient(90deg, rgba(15,9,4,0.68) 0%, rgba(15,9,4,0.28) 38%, rgba(15,9,4,0.16) 58%, rgba(15,9,4,0.62) 100%), linear-gradient(180deg, rgba(9,5,2,0.08) 0%, rgba(9,5,2,0.18) 38%, rgba(9,5,2,0.52) 74%, rgba(9,5,2,0.86) 100%)`
          }}
        />
      </div>

      <section className="relative z-10 flex min-h-screen flex-col justify-between px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10">
        <div className="inline-flex w-fit items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.34)] px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[rgba(255,248,232,0.92)] backdrop-blur-md">
          @querobroa
        </div>

        <div className="flex pb-4 sm:pb-6">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/18 bg-[rgba(56,34,14,0.44)] px-7 text-sm font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md transition-[background,transform,border-color] duration-500 ease-[cubic-bezier(.19,1,.22,1)] hover:border-white/28 hover:bg-[rgba(56,34,14,0.58)] hover:translate-y-[-1px]"
            href="/pedido"
          >
            Fazer pedido
          </Link>
        </div>
      </section>
    </main>
  );
}
