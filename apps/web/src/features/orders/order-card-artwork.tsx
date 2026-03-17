'use client';

import Image from 'next/image';
import type { OrderCardArt } from './order-box-catalog';

type OrderCardArtworkProps = {
  art: OrderCardArt;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  overlayClassName?: string;
};

const DIAGONAL_LEFT_CLIP = 'polygon(0 0, 62% 0, 38% 100%, 0 100%)';
const DIAGONAL_RIGHT_CLIP = 'polygon(62% 0, 100% 0, 100% 100%, 38% 100%)';

export function OrderCardArtwork({
  art,
  alt,
  sizes,
  priority = false,
  className = '',
  imageClassName = 'h-full w-full object-cover',
  overlayClassName = 'absolute inset-0 bg-[linear-gradient(180deg,transparent_22%,rgba(46,29,20,0.14)_100%)]'
}: OrderCardArtworkProps) {
  return (
    <div aria-label={alt} className={`relative h-full w-full overflow-hidden ${className}`} role="img">
      {art.mode === 'single' ? (
        <Image
          alt=""
          aria-hidden="true"
          className={imageClassName}
          fill
          priority={priority}
          sizes={sizes}
          src={art.src}
          style={{ objectPosition: art.objectPosition || 'center center' }}
        />
      ) : (
        <>
          <div className="absolute inset-0" style={{ clipPath: DIAGONAL_LEFT_CLIP }}>
            <Image
              alt=""
              aria-hidden="true"
              className={imageClassName}
              fill
              priority={priority}
              sizes={sizes}
              src={art.leftSrc}
              style={{ objectPosition: art.leftObjectPosition || 'center center' }}
            />
          </div>
          <div className="absolute inset-0" style={{ clipPath: DIAGONAL_RIGHT_CLIP }}>
            <Image
              alt=""
              aria-hidden="true"
              className={imageClassName}
              fill
              priority={priority}
              sizes={sizes}
              src={art.rightSrc}
              style={{ objectPosition: art.rightObjectPosition || 'center center' }}
            />
          </div>
        </>
      )}
      <div className={overlayClassName} />
    </div>
  );
}
