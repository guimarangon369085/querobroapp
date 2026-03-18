'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MutableRefObject,
  type Ref
} from 'react';
import {
  buildCustomerAddressAutofillFromGooglePlace,
  type CustomerAutofillPatch,
  type GooglePlaceResultLike
} from '@/lib/customer-autofill';
import { compactWhitespace } from '@/lib/format';
import {
  loadGooglePlacesAutocompleteDataLibrary,
  type GooglePlacesAutocompleteDataLibraryLike,
  type GooglePlacesAutocompleteSuggestionLike
} from '@/lib/google-places';

type GoogleAddressSuggestion = {
  id: string;
  kind: 'google' | 'manual';
  primary: string;
  secondary: string;
  value: string;
  googleSuggestion?: GooglePlacesAutocompleteSuggestionLike;
};

type GoogleAddressAutocompleteInputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'onChange' | 'value'
> & {
  googleApiKey?: string;
  googleEnabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  manualSuggestions?: string[];
  onGooglePlacePick?: (patch: CustomerAutofillPatch) => void;
  onValueChange: (value: string) => void;
  value: string;
};

const GOOGLE_ADDRESS_FETCH_MIN_LENGTH = 3;
const GOOGLE_ADDRESS_FETCH_DEBOUNCE_MS = 180;
const GOOGLE_ADDRESS_MAX_SUGGESTIONS = 6;

function assignRef(ref: Ref<HTMLInputElement> | undefined, node: HTMLInputElement | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  (ref as MutableRefObject<HTMLInputElement | null>).current = node;
}

function normalizeSuggestionKey(value: string) {
  return compactWhitespace(value).toLowerCase();
}

function mapGoogleSuggestion(
  suggestion: GooglePlacesAutocompleteSuggestionLike,
  index: number
): GoogleAddressSuggestion | null {
  const prediction = suggestion.placePrediction;
  const primary = compactWhitespace(prediction?.mainText?.text || prediction?.text?.text || '');
  const secondary = compactWhitespace(prediction?.secondaryText?.text || '');
  const value = compactWhitespace([primary, secondary].filter(Boolean).join(', '));
  if (!prediction?.toPlace || !value) return null;

  return {
    id: prediction.placeId || `google-${index}-${normalizeSuggestionKey(value)}`,
    kind: 'google',
    primary: primary || value,
    secondary,
    value,
    googleSuggestion: suggestion
  };
}

export function GoogleAddressAutocompleteInput({
  className,
  disabled,
  googleApiKey,
  googleEnabled = true,
  inputRef,
  manualSuggestions = [],
  onBlur,
  onFocus,
  onGooglePlacePick,
  onKeyDown,
  onValueChange,
  readOnly,
  value,
  ...inputProps
}: GoogleAddressAutocompleteInputProps) {
  const listboxId = useId();
  const blurTimerRef = useRef<number | null>(null);
  const requestSequenceRef = useRef(0);
  const googleLibraryRef = useRef<GooglePlacesAutocompleteDataLibraryLike | null>(null);
  const sessionTokenRef = useRef<unknown | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [googleSuggestions, setGoogleSuggestions] = useState<GoogleAddressSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const normalizedValue = compactWhitespace(value);
  const canUseGoogle = Boolean(googleEnabled && googleApiKey && !disabled && !readOnly);

  useEffect(() => {
    if (!canUseGoogle) {
      googleLibraryRef.current = null;
      sessionTokenRef.current = null;
      setIsGoogleReady(false);
      setGoogleSuggestions([]);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;

    const attemptLoad = () => {
      void loadGooglePlacesAutocompleteDataLibrary({ apiKey: googleApiKey as string })
        .then((library) => {
          if (cancelled) return;
          googleLibraryRef.current = library;
          setIsGoogleReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          googleLibraryRef.current = null;
          setIsGoogleReady(false);
          retryTimer = window.setTimeout(() => {
            attemptLoad();
          }, 400);
        });
    };

    attemptLoad();

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [canUseGoogle, googleApiKey]);

  const manualSuggestionEntries = useMemo(() => {
    const query = normalizeSuggestionKey(normalizedValue);
    if (!query) return [];

    const seen = new Set<string>();
    const nextEntries: GoogleAddressSuggestion[] = [];
    for (const suggestion of manualSuggestions) {
      const normalizedSuggestion = compactWhitespace(suggestion);
      const key = normalizeSuggestionKey(normalizedSuggestion);
      if (!normalizedSuggestion || !key.includes(query) || seen.has(key)) continue;
      seen.add(key);
      nextEntries.push({
        id: `manual-${key}`,
        kind: 'manual',
        primary: normalizedSuggestion,
        secondary: '',
        value: normalizedSuggestion
      });
      if (nextEntries.length >= GOOGLE_ADDRESS_MAX_SUGGESTIONS) break;
    }
    return nextEntries;
  }, [manualSuggestions, normalizedValue]);

  useEffect(() => {
    if (!isFocused || !canUseGoogle || !isGoogleReady) {
      setGoogleSuggestions([]);
      setIsLoading(false);
      return;
    }

    if (normalizedValue.length < GOOGLE_ADDRESS_FETCH_MIN_LENGTH) {
      sessionTokenRef.current = null;
      setGoogleSuggestions([]);
      setIsLoading(false);
      return;
    }

    const currentRequest = requestSequenceRef.current + 1;
    requestSequenceRef.current = currentRequest;
    setIsLoading(true);

    const timer = window.setTimeout(() => {
      const library = googleLibraryRef.current;
      if (!library?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        if (requestSequenceRef.current === currentRequest) {
          setGoogleSuggestions([]);
          setIsLoading(false);
        }
        return;
      }

      if (!sessionTokenRef.current && library.AutocompleteSessionToken) {
        sessionTokenRef.current = new library.AutocompleteSessionToken();
      }

      void library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: normalizedValue,
        includedRegionCodes: ['BR'],
        language: 'pt-BR',
        region: 'br',
        sessionToken: sessionTokenRef.current || undefined
      })
        .then((response) => {
          if (requestSequenceRef.current !== currentRequest) return;
          const nextSuggestions = (response.suggestions || [])
            .map((entry, index) => mapGoogleSuggestion(entry, index))
            .filter((entry): entry is GoogleAddressSuggestion => Boolean(entry))
            .slice(0, GOOGLE_ADDRESS_MAX_SUGGESTIONS);
          setGoogleSuggestions(nextSuggestions);
        })
        .catch(() => {
          if (requestSequenceRef.current !== currentRequest) return;
          setGoogleSuggestions([]);
        })
        .finally(() => {
          if (requestSequenceRef.current === currentRequest) {
            setIsLoading(false);
          }
        });
    }, GOOGLE_ADDRESS_FETCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canUseGoogle, isFocused, isGoogleReady, normalizedValue, value.length]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const merged: GoogleAddressSuggestion[] = [];

    for (const entry of [...manualSuggestionEntries, ...googleSuggestions]) {
      const key = normalizeSuggestionKey(entry.value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }

    return merged.slice(0, GOOGLE_ADDRESS_MAX_SUGGESTIONS);
  }, [googleSuggestions, manualSuggestionEntries]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((current) => {
      if (current < 0) return -1;
      return Math.min(current, suggestions.length - 1);
    });
  }, [suggestions]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const isListboxOpen = isFocused && suggestions.length > 0;

  const handleSuggestionPick = async (suggestion: GoogleAddressSuggestion) => {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }

    if (suggestion.kind === 'manual' || !suggestion.googleSuggestion?.placePrediction?.toPlace) {
      onValueChange(suggestion.value);
      setGoogleSuggestions([]);
      setActiveIndex(-1);
      setIsFocused(false);
      return;
    }

    const place = suggestion.googleSuggestion.placePrediction.toPlace();
    if (!place) {
      onValueChange(suggestion.value);
      setGoogleSuggestions([]);
      setActiveIndex(-1);
      setIsFocused(false);
      return;
    }

    try {
      await place.fetchFields?.({
        fields: ['addressComponents', 'formattedAddress', 'location']
      });
    } catch {
      onValueChange(suggestion.value);
      setGoogleSuggestions([]);
      setActiveIndex(-1);
      setIsFocused(false);
      sessionTokenRef.current = null;
      return;
    }

    const patch = buildCustomerAddressAutofillFromGooglePlace(place as GooglePlaceResultLike);
    const nextAddress = compactWhitespace(`${patch.address || suggestion.value}`) || suggestion.value;
    const nextPatch = {
      ...patch,
      address: nextAddress,
      placeId: patch.placeId || suggestion.googleSuggestion.placePrediction.placeId || ''
    };

    if (onGooglePlacePick) {
      onGooglePlacePick(nextPatch);
    } else {
      onValueChange(nextAddress);
    }

    setGoogleSuggestions([]);
    setActiveIndex(-1);
    setIsFocused(false);
    sessionTokenRef.current = null;
  };

  return (
    <div className="relative">
      <input
        {...inputProps}
        ref={(node) => {
          assignRef(inputRef, node);
        }}
        className={className}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={isListboxOpen ? listboxId : undefined}
        aria-expanded={isListboxOpen}
        aria-activedescendant={
          isListboxOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onChange={(event) => {
          if (!isFocused) {
            setIsFocused(true);
          }
          onValueChange(event.target.value);
        }}
        onFocus={(event) => {
          if (blurTimerRef.current) {
            window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          setIsFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          blurTimerRef.current = window.setTimeout(() => {
            setIsFocused(false);
            setActiveIndex(-1);
          }, 120);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (isListboxOpen && event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => {
              if (suggestions.length === 0) return -1;
              return current >= suggestions.length - 1 ? 0 : current + 1;
            });
            return;
          }

          if (isListboxOpen && event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => {
              if (suggestions.length === 0) return -1;
              return current <= 0 ? suggestions.length - 1 : current - 1;
            });
            return;
          }

          if (isListboxOpen && event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            void handleSuggestionPick(suggestions[activeIndex]);
            return;
          }

          if (event.key === 'Escape') {
            setIsFocused(false);
            setActiveIndex(-1);
          }

          onKeyDown?.(event);
        }}
      />

      {isListboxOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-30 overflow-hidden rounded-[20px] border border-[color:var(--line-soft)] bg-white/96 shadow-[0_18px_34px_rgba(54,31,20,0.12)] backdrop-blur-sm"
          role="listbox"
          id={listboxId}
        >
          <div className="grid gap-1 p-2">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                className={`flex w-full flex-col rounded-[16px] px-3 py-2.5 text-left transition ${
                  activeIndex === index
                    ? 'bg-[rgba(181,68,57,0.12)] text-[color:var(--ink-strong)]'
                    : 'bg-transparent text-[color:var(--ink-strong)] hover:bg-[rgba(126,79,45,0.08)]'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  void handleSuggestionPick(suggestion);
                }}
              >
                <span className="text-sm font-semibold leading-5">{suggestion.primary}</span>
                {suggestion.secondary ? (
                  <span className="text-xs leading-5 text-[color:var(--ink-muted)]">
                    {suggestion.secondary}
                  </span>
                ) : suggestion.kind === 'manual' ? (
                  <span className="text-xs leading-5 text-[color:var(--ink-muted)]">
                    Endereco ja usado
                  </span>
                ) : null}
              </button>
            ))}
            {isLoading ? (
              <div className="px-3 py-2 text-xs text-[color:var(--ink-muted)]">
                Buscando enderecos...
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
