type GoogleMapsNamespace = {
  places?: unknown;
  importLibrary?: (libraryName: string) => Promise<unknown>;
};

type GoogleMapsGlobal = {
  maps?: GoogleMapsNamespace;
};

declare global {
  interface Window {
    google?: GoogleMapsGlobal;
  }
}

type LoadGooglePlacesOptions = {
  apiKey: string;
  language?: string;
  region?: string;
};

export type GooglePlacesAutocompleteRequestLike = {
  input: string;
  includedRegionCodes?: string[];
  inputOffset?: number;
  language?: string;
  region?: string;
  sessionToken?: unknown;
};

export type GooglePlacesFormattableTextLike = {
  text?: string;
};

export type GooglePlacesPlaceLike = {
  fetchFields?: (options: { fields: string[] }) => Promise<unknown>;
};

export type GooglePlacesPlacePredictionLike = {
  mainText?: GooglePlacesFormattableTextLike;
  placeId?: string;
  secondaryText?: GooglePlacesFormattableTextLike;
  text?: GooglePlacesFormattableTextLike;
  toPlace?: () => GooglePlacesPlaceLike;
  types?: string[];
};

export type GooglePlacesAutocompleteSuggestionLike = {
  placePrediction?: GooglePlacesPlacePredictionLike;
};

export type GooglePlacesAutocompleteDataLibraryLike = {
  AutocompleteSessionToken?: new () => unknown;
  AutocompleteSuggestion?: {
    fetchAutocompleteSuggestions?: (
      request: GooglePlacesAutocompleteRequestLike
    ) => Promise<{ suggestions?: GooglePlacesAutocompleteSuggestionLike[] }>;
  };
};

let googlePlacesLoaderPromise: Promise<GoogleMapsGlobal> | null = null;

function buildGooglePlacesScriptUrl(options: LoadGooglePlacesOptions) {
  const url = new URL('https://maps.googleapis.com/maps/api/js');
  url.searchParams.set('key', options.apiKey);
  url.searchParams.set('libraries', 'places');
  url.searchParams.set('v', 'weekly');
  url.searchParams.set('loading', 'async');
  url.searchParams.set('language', options.language || 'pt-BR');
  url.searchParams.set('region', options.region || 'BR');
  return url.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function ensurePlacesLibraryAvailable() {
  const mapsApi = window.google?.maps;
  if (!mapsApi) return null;
  if (mapsApi.places) return window.google ?? null;

  if (typeof mapsApi.importLibrary === 'function') {
    try {
      await mapsApi.importLibrary('places');
    } catch {
      // `importLibrary` can fail when the key has no Places access; fallback to passive wait below.
    }
    if (window.google?.maps?.places) {
      return window.google;
    }
  }

  const start = Date.now();
  const timeoutMs = 5000;
  while (Date.now() - start < timeoutMs) {
    if (window.google?.maps?.places) {
      return window.google;
    }
    await sleep(120);
  }
  return null;
}

export async function loadGooglePlacesLibrary(options: LoadGooglePlacesOptions) {
  if (typeof window === 'undefined') {
    throw new Error('Google Places so pode ser carregado no navegador.');
  }

  if (window.google?.maps?.places) {
    return window.google;
  }

  if (googlePlacesLoaderPromise) {
    return googlePlacesLoaderPromise;
  }

  const scriptSelector = 'script[data-google-places-loader="1"]';
  const existingScript = document.querySelector<HTMLScriptElement>(scriptSelector);
  googlePlacesLoaderPromise = new Promise<GoogleMapsGlobal>((resolve, reject) => {
    const onReady = () => {
      void ensurePlacesLibraryAvailable()
        .then((google) => {
          if (google?.maps?.places) {
            resolve(google);
            return;
          }
          reject(new Error('Google Places indisponivel apos carregar script.'));
        })
        .catch((error) => {
          reject(error instanceof Error ? error : new Error('Falha ao inicializar Google Places.'));
        });
    };

    if (existingScript) {
      if (existingScript.dataset.googlePlacesLoaded === '1' || window.google?.maps) {
        onReady();
        return;
      }
      existingScript.addEventListener('load', onReady, { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Falha ao carregar script do Google Maps.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = buildGooglePlacesScriptUrl(options);
    script.async = true;
    script.defer = true;
    script.setAttribute('data-google-places-loader', '1');
    script.onload = () => {
      script.dataset.googlePlacesLoaded = '1';
      onReady();
    };
    script.onerror = () => reject(new Error('Falha ao carregar script do Google Maps.'));
    document.head.appendChild(script);
  })
    .catch((error) => {
      googlePlacesLoaderPromise = null;
      throw error;
    });

  return googlePlacesLoaderPromise;
}

export async function loadGooglePlacesAutocompleteDataLibrary(options: LoadGooglePlacesOptions) {
  const google = await loadGooglePlacesLibrary(options);
  const start = Date.now();
  const timeoutMs = 5000;

  while (Date.now() - start < timeoutMs) {
    const mapsApi = google.maps;
    if (typeof mapsApi?.importLibrary !== 'function') {
      await sleep(120);
      continue;
    }

    try {
      const library = (await mapsApi.importLibrary('places')) as GooglePlacesAutocompleteDataLibraryLike;
      if (library.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
        return library;
      }
    } catch {
      // The Maps script may still be hydrating the Places data layer; retry until timeout below.
    }

    await sleep(120);
  }

  throw new Error('Autocomplete Data indisponivel no Google Places atual.');
}
