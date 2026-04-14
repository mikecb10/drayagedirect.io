/**
 * Singleton loader for the Google Maps JS API.
 * Ensures the script is only added to the page once, even if multiple components
 * call loadGoogleMaps() simultaneously.
 */

let loadPromise = null;

export function loadGoogleMaps() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in the browser'));
  }

  // Already loaded
  if (window.google?.maps?.places) {
    return Promise.resolve(window.google);
  }

  // Load in progress
  if (loadPromise) {
    return loadPromise;
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error(
        'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set. Add it to .env.local and restart the dev server.'
      )
    );
  }

  loadPromise = new Promise((resolve, reject) => {
    // Check if the script tag already exists (e.g. added by another component)
    const existingScript = document.querySelector('script[data-dd-google-maps]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google));
      existingScript.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,drawing&v=weekly`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-dd-google-maps', 'true');

    script.addEventListener('load', () => {
      if (window.google?.maps?.places) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps loaded but Places library is missing'));
      }
    });

    script.addEventListener('error', () => {
      loadPromise = null; // allow retry
      reject(new Error('Failed to load Google Maps — check your API key and enabled services'));
    });

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Parse a Google Places PlaceResult into a flat address object.
 * Returns: { street, city, state, zip, country, lat, lng, formatted }
 */
export function parseAddressComponents(place) {
  if (!place || !place.address_components) return null;

  const components = place.address_components;
  const getComponent = (type, useShort = false) => {
    const found = components.find((c) => c.types.includes(type));
    if (!found) return '';
    return useShort ? found.short_name : found.long_name;
  };

  const streetNumber = getComponent('street_number');
  const route = getComponent('route');
  const street = [streetNumber, route].filter(Boolean).join(' ');

  return {
    street,
    city:
      getComponent('locality') ||
      getComponent('sublocality') ||
      getComponent('postal_town') ||
      getComponent('administrative_area_level_2'),
    state: getComponent('administrative_area_level_1', true),
    zip: getComponent('postal_code'),
    country: getComponent('country', true),
    lat: place.geometry?.location?.lat?.(),
    lng: place.geometry?.location?.lng?.(),
    formatted: place.formatted_address || '',
  };
}
