import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
  interface Window {
    google: any;
  }
}

interface Props {
  address: string;
  lat: number;
  lng: number;
  onConfirm: (lat: number, lng: number) => Promise<void>;
  onReject: () => void;
}

/**
 * NOTE: The Google Maps JavaScript API must be enabled for your API key.
 * Go to https://console.cloud.google.com/apis/library/maps-backend.googleapis.com
 * and enable "Maps JavaScript API" for the project associated with GOOGLE_SOLAR_API_KEY.
 */

// Load the Google Maps script once globally
let mapsLoaded = false;
let mapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (mapsLoaded) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      mapsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

export function ConfirmAddress({ address, lat, lng, onConfirm, onReject }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const [pinDragged, setPinDragged] = useState(false);
  const [confirmedLat, setConfirmedLat] = useState(lat);
  const [confirmedLng, setConfirmedLng] = useState(lng);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState(false);

  const initMap = useCallback(async () => {
    try {
      // Get the API key from the server
      const res = await fetch('/api/roof/maps-key');
      const { key } = await res.json();
      await loadGoogleMaps(key);

      if (!mapRef.current) return;

      const position = { lat, lng };

      const google = window.google;
      const map = new google.maps.Map(mapRef.current, {
        center: position,
        zoom: 20,
        mapTypeId: 'hybrid',
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        mapId: 'confirm-address-map',
      });

      // Use classic Marker with draggable (AdvancedMarkerElement drag requires extra setup)
      const marker = new google.maps.Marker({
        position,
        map,
        draggable: true,
        title: 'Your home',
      });

      marker.addListener('dragend', () => {
        const pos = marker.getPosition();
        if (pos) {
          setConfirmedLat(pos.lat());
          setConfirmedLng(pos.lng());
          setPinDragged(true);
        }
      });
    } catch (err) {
      console.error('Map init error:', err);
      setMapError(true);
    }
  }, [lat, lng]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  const handleConfirm = async (useLat: number, useLng: number) => {
    setLoading(true);
    setError('');
    try {
      await onConfirm(useLat, useLng);
    } catch (err: any) {
      setError(err.message || 'Failed to get quote. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h1 className="card__title">Is this your home?</h1>
      <p className="card__subtitle">📍 {address}</p>

      {mapError ? (
        <div className="confirm-image-error">
          <p>🗺️ Map unavailable. You can still proceed if the address looks correct.</p>
        </div>
      ) : (
        <div
          ref={mapRef}
          className="confirm-map"
          style={{
            width: '100%',
            height: '300px',
            borderRadius: '12px',
            overflow: 'hidden',
            marginBottom: '16px',
          }}
        />
      )}

      {pinDragged && (
        <p style={{ fontSize: 13, color: 'var(--gray-500)', textAlign: 'center', margin: '0 0 12px' }}>
          📌 Pin moved — we'll use the updated location for your quote.
        </p>
      )}

      {error && <div className="error-msg">{error}</div>}

      <div className="confirm-buttons">
        {!pinDragged ? (
          <>
            <button
              className="btn btn--primary"
              onClick={() => handleConfirm(lat, lng)}
              disabled={loading}
            >
              {loading && <span className="spinner" />}
              {loading ? 'Analyzing Your Roof...' : 'Yes, Get My Quote'}
            </button>
            <button className="btn btn--outline" onClick={onReject} disabled={loading}>
              Not my house
            </button>
            <p style={{ fontSize: 12, color: 'var(--gray-500)', textAlign: 'center', marginTop: 8 }}>
              Wrong spot? Drag the pin to your home, then confirm.
            </p>
          </>
        ) : (
          <>
            <button
              className="btn btn--primary"
              onClick={() => handleConfirm(confirmedLat, confirmedLng)}
              disabled={loading}
            >
              {loading && <span className="spinner" />}
              {loading ? 'Analyzing Your Roof...' : 'Confirm This Location'}
            </button>
            <button className="btn btn--outline" onClick={onReject} disabled={loading}>
              Start over
            </button>
          </>
        )}
      </div>
    </div>
  );
}
