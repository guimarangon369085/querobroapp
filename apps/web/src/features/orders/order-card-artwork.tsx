'use client';
/* eslint-disable @next/next/no-img-element */

import type { OrderCardArt } from './order-box-catalog';
import { resolveBuilderImageSrc } from '@/lib/builder';

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
  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : 'auto';

  const renderArtworkImage = (src: string, objectPosition?: string) => (
    <img
      alt=""
      aria-hidden="true"
      className={imageClassName}
      fetchPriority={fetchPriority}
      loading={loading}
      sizes={sizes}
      src={resolveBuilderImageSrc(src)}
      style={{ objectPosition: objectPosition || 'center center' }}
    />
  );

  return (
    <div aria-label={alt} className={`relative h-full w-full overflow-hidden ${className}`} role="img">
      {art.mode === 'single' ? (
        renderArtworkImage(art.src, art.objectPosition)
      ) : art.mode === 'columns' ? (
        <div
          className="absolute inset-0"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${art.columns.length}, minmax(0, 1fr))`
          }}
        >
          {art.columns.map((column, index) => (
            <div
              key={`${column.src}-${index}`}
              className={`relative min-w-0 overflow-hidden ${index > 0 ? 'border-l border-white/20' : ''}`}
            >
              {renderArtworkImage(column.src, column.objectPosition)}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="absolute inset-0" style={{ clipPath: DIAGONAL_LEFT_CLIP }}>
            {renderArtworkImage(art.leftSrc, art.leftObjectPosition)}
          </div>
          <div className="absolute inset-0" style={{ clipPath: DIAGONAL_RIGHT_CLIP }}>
            {renderArtworkImage(art.rightSrc, art.rightObjectPosition)}
          </div>
        </>
      )}
      <div className={overlayClassName} />
    </div>
  );
}
