'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOperationFlow } from '@/hooks/use-operation-flow';
import styles from './page.module.css';

function modeLabel(mode: 'loading' | 'online' | 'offline') {
  if (mode === 'online') return 'online';
  if (mode === 'offline') return 'offline';
  return 'carregando';
}

export default function JornadaPage() {
  const { flow, mode, refreshing, error, refresh } = useOperationFlow({ refreshIntervalMs: 30000 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');

  useEffect(() => {
    const exists = selectedKey ? flow.steps.some((step) => step.key === selectedKey) : false;
    if (selectionMode === 'auto' || !exists) {
      setSelectedKey(flow.currentStep.key);
    }
  }, [flow.currentStep.key, flow.steps, selectedKey, selectionMode]);

  const selectedStep = useMemo(
    () => flow.steps.find((step) => step.key === selectedKey) || flow.currentStep,
    [flow.currentStep, flow.steps, selectedKey]
  );
  const selectedIndex = flow.steps.findIndex((step) => step.key === selectedStep.key);
  const currentIndex = flow.steps.findIndex((step) => step.key === flow.currentStep.key);

  const goToIndex = useCallback(
    (index: number, modeOverride: 'auto' | 'manual' = 'manual') => {
      const target = flow.steps[index];
      if (!target) return;
      setSelectionMode(modeOverride);
      setSelectedKey(target.key);
    },
    [flow.steps]
  );

  const goPrev = useCallback(() => {
    if (selectedIndex <= 0) return;
    goToIndex(selectedIndex - 1);
  }, [goToIndex, selectedIndex]);

  const goNext = useCallback(() => {
    if (selectedIndex >= flow.steps.length - 1) return;
    goToIndex(selectedIndex + 1);
  }, [flow.steps.length, goToIndex, selectedIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, goPrev]);

  const actionStep = selectedStep.state === 'locked' ? flow.currentStep : selectedStep;
  const isPinnedToCurrent = selectionMode === 'auto' && selectedStep.key === flow.currentStep.key;

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Modo aventura da broa</p>
          <h2 className={styles.title}>Um passo por vez</h2>
        </div>

        <div className={styles.meta}>
          <span>{selectedStep.index}/7</span>
          <span>{flow.progressPercent}%</span>
          <span>{flow.metrics.openOrders} abertos</span>
          <span>{modeLabel(mode)}</span>
        </div>

        <div className={styles.progress}>
          <span className={styles.progressFill} style={{ width: `${flow.progressPercent}%` }} />
        </div>

        <div className={styles.controls}>
          <button type="button" className={styles.control} onClick={goPrev} disabled={selectedIndex <= 0}>
            anterior
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={goNext}
            disabled={selectedIndex >= flow.steps.length - 1}
          >
            proxima
          </button>
          <button type="button" className={styles.ghost} onClick={() => refresh()} disabled={refreshing}>
            {refreshing ? 'Atualizando' : 'Atualizar'}
          </button>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => goToIndex(currentIndex, 'auto')}
            disabled={isPinnedToCurrent}
          >
            passo atual
          </button>
        </div>
      </header>

      <ol className={styles.map}>
        {flow.steps.map((step, index) => {
          const rowSide = index % 2 === 0 ? styles.rowRight : styles.rowLeft;
          const isSelected = selectedStep.key === step.key;
          const isMuted = !isSelected;
          const balloonSide = index % 2 === 0 ? styles.balloonLeft : styles.balloonRight;

          return (
            <li key={step.key} className={`${styles.row} ${rowSide} ${isMuted ? styles.rowMuted : ''}`}>
              <button
                type="button"
                className={`${styles.node} ${styles[`node${step.state[0].toUpperCase()}${step.state.slice(1)}`]}`}
                aria-label={`Etapa ${step.index}: ${step.title}`}
                onClick={() => {
                  setSelectionMode('manual');
                  setSelectedKey(step.key);
                }}
              >
                <span className={styles.nodeIndex}>{step.index}</span>
                <span className={styles.nodeIcon}>{step.icon}</span>
              </button>

              <p className={styles.rowTitle}>{step.title}</p>

              {isSelected ? (
                <div className={`${styles.balloon} ${balloonSide}`}>
                  <p className={styles.balloonStatus}>{step.statusLabel}</p>
                  <p className={styles.balloonTitle}>{step.question}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <section className={styles.missionBar} aria-label="Missao atual">
        <div>
          <p className={styles.missionKicker}>
            Missao {selectedStep.index}
            {selectedStep.state === 'locked' ? ` (siga pela ${flow.currentStep.index})` : ''}
          </p>
          <p className={styles.missionTitle}>{selectedStep.question}</p>
        </div>
        <div className={styles.actions}>
          <Link href={actionStep.href} className={styles.primary}>
            {selectedStep.state === 'locked' ? `Abrir etapa ${flow.currentStep.index}` : selectedStep.actionLabel}
          </Link>
          <Link href={flow.steps[Math.max(currentIndex - 1, 0)].href} className={styles.ghost}>
            revisar
          </Link>
        </div>
      </section>

      {error && mode === 'offline' ? (
        <details className={styles.error}>
          <summary>Detalhe tecnico</summary>
          <p>{error}</p>
        </details>
      ) : null}
    </section>
  );
}
