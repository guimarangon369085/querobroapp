'use client';

type SearchParamsLike = {
  get(name: string): string | null;
};

export function useTutorialSpotlight(
  _searchParams: SearchParamsLike,
  _tutorialValue = 'primeira_vez'
) {
  const tutorialMode = false;
  const spotlightSlotId = '';

  const isSpotlightSlot = (_slotId: string) => false;

  return {
    tutorialMode,
    spotlightSlotId,
    isSpotlightSlot
  };
}
