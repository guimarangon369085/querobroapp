'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

type HeroImage = {
  accent: string;
  alt: string;
  glow: string;
  id: number;
  objectPosition?: string;
  src: string;
};

type PointerState = {
  moved: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  width: number;
};

const TONES = [
  {
    accent: 'rgba(248, 197, 89, 0.24)',
    glow: 'rgba(255, 214, 120, 0.34)'
  },
  {
    accent: 'rgba(196, 64, 52, 0.24)',
    glow: 'rgba(228, 94, 79, 0.3)'
  },
  {
    accent: 'rgba(134, 166, 118, 0.24)',
    glow: 'rgba(174, 208, 153, 0.28)'
  },
  {
    accent: 'rgba(202, 94, 146, 0.24)',
    glow: 'rgba(238, 143, 188, 0.28)'
  },
  {
    accent: 'rgba(91, 121, 167, 0.24)',
    glow: 'rgba(121, 160, 219, 0.28)'
  },
  {
    accent: 'rgba(118, 77, 42, 0.26)',
    glow: 'rgba(162, 112, 70, 0.26)'
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

const AUTOPLAY_MS = 4200;
const INITIAL_INDEX = 7;
const SWIPE_THRESHOLD = 0.12;
const INITIAL_POINTER = { x: 0.52, y: 0.34 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapIndex(index: number, total: number) {
  return (index + total) % total;
}

function imageStyleForLayer(
  relation: -1 | 0 | 1,
  dragRatio: number,
  pointer: { x: number; y: number }
) {
  const pointerX = (pointer.x - 0.5) * 36;
  const pointerY = (pointer.y - 0.5) * 22;
  const swipeBias = dragRatio * 34;

  if (relation === 0) {
    return {
      filter: 'saturate(1.02)',
      opacity: clamp(1 - Math.abs(dragRatio) * 0.55, 0.4, 1),
      transform: `translate3d(${pointerX + swipeBias}px, ${pointerY}px, 0) scale(1.06)`
    } satisfies CSSProperties;
  }

  const directionalLift = relation === -1 ? -24 : 24;
  const dragLift = relation === -1 ? Math.max(dragRatio, 0) : Math.max(-dragRatio, 0);

  return {
    filter: 'saturate(0.86) blur(1px)',
    opacity: clamp(0.16 + dragLift * 0.84, 0.16, 0.88),
    transform: `translate3d(${pointerX * 0.45 + directionalLift + swipeBias}px, ${
      pointerY * 0.35 + relation * 6
    }px, 0) scale(1.14)`
  } satisfies CSSProperties;
}

export function ImmersiveHomeHero() {
  const [activeIndex, setActiveIndex] = useState(INITIAL_INDEX);
  const [dragRatio, setDragRatio] = useState(0);
  const [isInteracting, setIsInteracting] = useState(false);
  const [pointer, setPointer] = useState(INITIAL_POINTER);
  const pointerStateRef = useRef<PointerState>({
    moved: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    width: 1
  });
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeImage = HOME_HERO_IMAGES[activeIndex];
  const previousIndex = wrapIndex(activeIndex - 1, HOME_HERO_IMAGES.length);
  const nextIndex = wrapIndex(activeIndex + 1, HOME_HERO_IMAGES.length);
  const previewImages = useMemo(
    () =>
      [1, 2, 3].map((offset) => ({
        image: HOME_HERO_IMAGES[wrapIndex(activeIndex + offset, HOME_HERO_IMAGES.length)],
        offset
      })),
    [activeIndex]
  );

  const setIndex = (nextIndex: number) => {
    startTransition(() => {
      setActiveIndex(wrapIndex(nextIndex, HOME_HERO_IMAGES.length));
    });
  };

  const step = (delta: number) => {
    setIndex(activeIndex + delta);
  };

  useEffect(() => {
    if (isInteracting) return undefined;

    const autoplay = window.setInterval(() => {
      startTransition(() => {
        setActiveIndex((current) => wrapIndex(current + 1, HOME_HERO_IMAGES.length));
      });
    }, AUTOPLAY_MS);

    return () => {
      window.clearInterval(autoplay);
    };
  }, [isInteracting]);

  useEffect(() => {
    thumbnailRefs.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }, [activeIndex]);

  const updatePointer = (
    event: Pick<ReactPointerEvent<HTMLDivElement>, 'clientX' | 'clientY' | 'currentTarget'>
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    setPointer({
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    updatePointer(event);

    const pointerState = pointerStateRef.current;
    if (pointerState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - pointerState.startX;
    const deltaY = event.clientY - pointerState.startY;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (Math.abs(deltaX) > pointerState.width * SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      step(deltaX > 0 ? -1 : 1);
    }

    pointerStateRef.current = {
      moved: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      width: 1
    };
    setDragRatio(0);
    setIsInteracting(false);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#160f09] text-white">
      <div
        className="absolute inset-0"
        onPointerCancel={finishPointer}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('a,button')) return;

          updatePointer(event);
          pointerStateRef.current = {
            moved: false,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            width: event.currentTarget.clientWidth || 1
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsInteracting(true);
        }}
        onPointerLeave={(event) => {
          if (pointerStateRef.current.pointerId !== null) return;

          updatePointer(event);
          setPointer(INITIAL_POINTER);
          setDragRatio(0);
          setIsInteracting(false);
        }}
        onPointerMove={(event) => {
          updatePointer(event);

          const pointerState = pointerStateRef.current;
          if (pointerState.pointerId !== event.pointerId) return;

          const deltaX = event.clientX - pointerState.startX;
          const deltaY = event.clientY - pointerState.startY;
          if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
            pointerState.moved = true;
          }

          if (Math.abs(deltaX) >= Math.abs(deltaY)) {
            setDragRatio(clamp(deltaX / pointerState.width, -1, 1));
          }
        }}
        onPointerUp={finishPointer}
        style={{ touchAction: 'pan-y' }}
      >
        {[previousIndex, activeIndex, nextIndex].map((index) => {
          const relation = index === activeIndex ? 0 : index === previousIndex ? -1 : 1;
          const image = HOME_HERO_IMAGES[index];

          return (
            <div
              key={image.src}
              className="absolute inset-[-4%] transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(.22,1,.36,1)]"
              style={imageStyleForLayer(relation, dragRatio, pointer)}
            >
              <Image
                alt=""
                aria-hidden
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
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at ${pointer.x * 100}% ${pointer.y * 100}%, ${activeImage.glow} 0%, transparent 34%), radial-gradient(circle at 82% 18%, ${activeImage.accent} 0%, transparent 26%), linear-gradient(90deg, rgba(19,11,5,0.78) 0%, rgba(19,11,5,0.42) 34%, rgba(19,11,5,0.16) 58%, rgba(19,11,5,0.62) 100%), linear-gradient(180deg, rgba(18,10,5,0.08) 0%, rgba(18,10,5,0.14) 34%, rgba(18,10,5,0.5) 72%, rgba(10,6,3,0.84) 100%)`
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-[24vh] bg-[linear-gradient(180deg,rgba(10,6,3,0)_0%,rgba(10,6,3,0.28)_32%,rgba(10,6,3,0.84)_100%)]" />
      </div>

      <section className="relative z-10 flex min-h-screen flex-col justify-between gap-8 px-5 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-10">
        <div className="flex items-start justify-between gap-4">
          <div className="inline-flex items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.36)] px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[rgba(255,248,232,0.9)] backdrop-blur-md">
            querobroa.com.br
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/12 bg-[rgba(26,15,8,0.28)] px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/72 backdrop-blur-md sm:inline-flex">
            <span>{String(activeImage.id).padStart(2, '0')}</span>
            <span className="text-white/35">/</span>
            <span>{HOME_HERO_IMAGES.length}</span>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="max-w-[36rem]">
            <h1
              className="text-[clamp(3.4rem,11vw,8rem)] font-semibold leading-[0.86] tracking-[-0.07em] text-[rgba(255,249,239,0.98)]"
              style={{
                fontFamily:
                  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif'
              }}
            >
              QUEROBROA
            </h1>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/18 bg-[rgba(56,34,14,0.46)] px-6 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-[rgba(56,34,14,0.62)]"
                href="/pedido"
              >
                Fazer pedido
              </Link>
              <div className="hidden items-center gap-2 sm:flex">
                <button
                  aria-label="Imagem anterior"
                  className="grid h-11 w-11 place-items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.32)] text-white/78 backdrop-blur-md transition hover:bg-[rgba(26,15,8,0.5)] hover:text-white"
                  onClick={() => step(-1)}
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  aria-label="Próxima imagem"
                  className="grid h-11 w-11 place-items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.32)] text-white/78 backdrop-blur-md transition hover:bg-[rgba(26,15,8,0.5)] hover:text-white"
                  onClick={() => step(1)}
                  type="button"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="relative hidden h-[430px] lg:block">
            {previewImages
              .slice()
              .reverse()
              .map(({ image, offset }, stackIndex) => {
                const depth = previewImages.length - stackIndex;
                const transform = `translate3d(${(pointer.x - 0.5) * 22 + stackIndex * 26}px, ${
                  (pointer.y - 0.5) * 20 + stackIndex * 54
                }px, 0) rotate(${(pointer.x - 0.5) * 7 + stackIndex * 4}deg)`;

                return (
                  <button
                    key={image.src}
                    aria-label={`Abrir imagem ${image.id}`}
                    className="absolute right-0 top-0 overflow-hidden rounded-[28px] border border-white/16 bg-[rgba(255,255,255,0.06)] shadow-[0_24px_60px_rgba(8,4,2,0.28)] transition-[transform,box-shadow,border-color] duration-500 ease-[cubic-bezier(.22,1,.36,1)] hover:border-white/28 hover:shadow-[0_30px_78px_rgba(8,4,2,0.34)]"
                    onClick={() => setIndex(activeIndex + depth)}
                    style={{
                      height: `${220 + stackIndex * 16}px`,
                      transform,
                      width: `${172 + stackIndex * 18}px`,
                      zIndex: depth
                    }}
                    type="button"
                  >
                    <Image
                      alt=""
                      aria-hidden
                      className="object-cover"
                      fill
                      quality={80}
                      sizes="(max-width: 1279px) 220px, 260px"
                      src={image.src}
                      style={{ objectPosition: image.objectPosition }}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,8,4,0.02)_0%,rgba(15,8,4,0.08)_42%,rgba(15,8,4,0.52)_100%)]" />
                    <div className="absolute bottom-4 left-4 rounded-full border border-white/14 bg-[rgba(18,10,5,0.42)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white/82 backdrop-blur-md">
                      {String(image.id).padStart(2, '0')}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>

        <div className="rounded-[30px] border border-white/12 bg-[rgba(20,11,5,0.3)] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-white/56">
              21 imagens
            </p>
            <div className="flex items-center gap-2 sm:hidden">
              <button
                aria-label="Imagem anterior"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.32)] text-white/78 backdrop-blur-md transition hover:bg-[rgba(26,15,8,0.5)] hover:text-white"
                onClick={() => step(-1)}
                type="button"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                aria-label="Próxima imagem"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/14 bg-[rgba(26,15,8,0.32)] text-white/78 backdrop-blur-md transition hover:bg-[rgba(26,15,8,0.5)] hover:text-white"
                onClick={() => step(1)}
                type="button"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {HOME_HERO_IMAGES.map((image, index) => {
              const active = index === activeIndex;
              return (
                <button
                  key={image.src}
                  aria-label={`Mostrar imagem ${image.id} de ${HOME_HERO_IMAGES.length}`}
                  className={`group relative shrink-0 overflow-hidden rounded-[22px] border transition-[width,height,transform,border-color,box-shadow] duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${
                    active
                      ? 'h-28 w-24 border-white/30 shadow-[0_16px_34px_rgba(8,4,2,0.28)] sm:w-28'
                      : 'h-20 w-16 border-white/10 hover:border-white/22 sm:w-20'
                  }`}
                  onClick={() => setIndex(index)}
                  ref={(node) => {
                    thumbnailRefs.current[index] = node;
                  }}
                  type="button"
                >
                  <Image
                    alt=""
                    aria-hidden
                    className={`object-cover transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${
                      active ? 'scale-100' : 'scale-[1.04] group-hover:scale-100'
                    }`}
                    fill
                    quality={70}
                    sizes="112px"
                    src={image.src}
                    style={{ objectPosition: image.objectPosition }}
                  />
                  <div
                    className={`absolute inset-0 transition-colors duration-500 ${
                      active
                        ? 'bg-[linear-gradient(180deg,rgba(16,9,4,0.02)_0%,rgba(16,9,4,0.08)_46%,rgba(16,9,4,0.5)_100%)]'
                        : 'bg-[linear-gradient(180deg,rgba(16,9,4,0.12)_0%,rgba(16,9,4,0.26)_52%,rgba(16,9,4,0.7)_100%)]'
                    }`}
                  />
                  <span className="absolute bottom-2 left-2 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-white/84">
                    {String(image.id).padStart(2, '0')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
