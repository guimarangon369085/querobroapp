'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useState } from 'react';
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
  managedUploadFit?: 'contain' | 'cover' | 'contain-tight';
};

const DIAGONAL_LEFT_CLIP = 'polygon(0 0, 62% 0, 38% 100%, 0 100%)';
const DIAGONAL_RIGHT_CLIP = 'polygon(62% 0, 100% 0, 100% 100%, 38% 100%)';
const ORDER_CARD_ARTWORK_FALLBACK_SRC = '/querobroa-brand/cardapio/sabores-caixa.jpg?v=20260422-rj3';

function isManagedProductUpload(src: string) {
  return /\/uploads\/products\//i.test(src);
}

export function OrderCardArtwork({
  art,
  alt,
  sizes,
  priority = false,
  className = '',
  imageClassName = 'h-full w-full object-cover',
  overlayClassName = 'absolute inset-0 bg-[linear-gradient(180deg,transparent_22%,rgba(46,29,20,0.14)_100%)]',
  managedUploadFit = 'cover'
}: OrderCardArtworkProps) {
  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : 'auto';
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});

  const markImageAsFailed = useCallback((src: string) => {
    setFailedSources((current) => (current[src] ? current : { ...current, [src]: true }));
  }, []);

  const renderArtworkImage = (src: string, objectPosition?: string) => {
    const resolvedSrc = resolveBuilderImageSrc(src);
    const effectiveSrc = failedSources[resolvedSrc] ? ORDER_CARD_ARTWORK_FALLBACK_SRC : resolvedSrc;
    const resolvedObjectPosition = objectPosition || 'center center';
    const handleImageError = () => {
      if (effectiveSrc !== ORDER_CARD_ARTWORK_FALLBACK_SRC) {
        markImageAsFailed(resolvedSrc);
      }
    };

    if (
      isManagedProductUpload(effectiveSrc) &&
      (managedUploadFit === 'contain' || managedUploadFit === 'contain-tight')
    ) {
      const insetClassName = managedUploadFit === 'contain-tight' ? 'absolute inset-0' : 'absolute inset-[10%]';
      return (
        <div className="relative h-full w-full overflow-hidden">
          <div className={`${insetClassName} flex items-center justify-center`}>
            <img
              alt=""
              aria-hidden="true"
              className="h-full w-full object-contain drop-shadow-[0_10px_22px_rgba(60,38,24,0.2)]"
              fetchPriority={fetchPriority}
              loading={loading}
              onError={handleImageError}
              sizes={sizes}
              src={effectiveSrc}
              style={{ objectPosition: resolvedObjectPosition }}
            />
          </div>
        </div>
      );
    }

    return (
      <img
        alt=""
        aria-hidden="true"
        className={imageClassName}
        fetchPriority={fetchPriority}
        loading={loading}
        onError={handleImageError}
        sizes={sizes}
        src={effectiveSrc}
        style={{ objectPosition: resolvedObjectPosition }}
      />
    );
  };

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
      ) : art.mode === 'weighted-columns' ? (
        <div
          className="absolute inset-0"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${art.columns.reduce((sum, column) => sum + Math.max(column.span || 1, 1), 0)}, minmax(0, 1fr))`
          }}
        >
          {art.columns.map((column, index) => (
            <div
              key={`${column.src}-${index}`}
              className={`relative min-w-0 overflow-hidden ${index > 0 ? 'border-l border-white/20' : ''}`}
              style={{ gridColumn: `span ${Math.max(column.span || 1, 1)}` }}
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
