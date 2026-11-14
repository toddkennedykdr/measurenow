import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { NavBar } from './components/NavBar';
import { BrandLogo } from './components/BrandLogo';
import { isFramedWindow, notifyParentHeight, notifyParentLeadSubmitted, quotePageChrome, replyToParentPing } from './quoteChrome';
import type { GeocodeResponse, FullQuoteData, Step } from './types';
import { AddressForm } from './components/AddressForm';
import { ConfirmAddress } from './components/ConfirmAddress';
import { QuoteGate } from './components/QuoteGate';
import { QuoteResult } from './components/QuoteResult';

const QUOTE_TOKEN_KEY = 'measurenow.quoteAccess';

type GateDraft = {
  quoteId: string;
  address: string;
};

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(QUOTE_TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw).token;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

function storeToken(token: string) {
  sessionStorage.setItem(QUOTE_TOKEN_KEY, JSON.stringify({ token }));
}

function quoteFromPayload(data: FullQuoteData & { token?: string; leadCreated?: boolean }): FullQuoteData {
  return {
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    roofData: data.roofData,
    quote: data.quote,
  };
}

export default function App() {
  const location = useLocation();
  const { hideHeader } = quotePageChrome({
    pathname: location.pathname,
    search: location.search,
    framed: isFramedWindow(),
    loggedIn: false,
  });
  const [step, setStep] = useState<Step>('address');
  const [geocodeData, setGeocodeData] = useState<GeocodeResponse | null>(null);
  const [gateDraft, setGateDraft] = useState<GateDraft | null>(null);
  const [quoteData, setQuoteData] = useState<FullQuoteData | null>(null);
  const [gateError, setGateError] = useState('');
  const [gateSubmitting, setGateSubmitting] = useState(false);

  const handleGeocoded = (data: GeocodeResponse) => {
    setGeocodeData(data);
    setStep('confirm');
  };

  const handleLocationConfirmed = async (lat: number, lng: number) => {
    const res = await fetch('/api/roof/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get quote');
    if (!data.quoteId || !geocodeData) throw new Error(data.error || 'Failed to get quote');
    setGateDraft({ quoteId: data.quoteId, address: geocodeData.address });
    setGateError('');
    setStep('gate');
  };

  const handleNotMyHome = () => {
    setStep('address');
    setGeocodeData(null);
    setGateDraft(null);
    setQuoteData(null);
  };

  const handleGateSubmit = async (fields: { name: string; email: string; phone: string; address: string }) => {
    if (!gateDraft) return;
    setGateSubmitting(true);
    setGateError('');
    try {
      const res = await fetch('/api/roof/quote-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: gateDraft.quoteId, ...fields }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGateError(data.error || 'Something went wrong.');
        return;
      }
      if (typeof data.token === 'string') storeToken(data.token);
      setQuoteData(quoteFromPayload(data));
      if (data.leadCreated) notifyParentLeadSubmitted();
      setStep('quote');
    } catch {
      setGateError('Network error. Please try again.');
    } finally {
      setGateSubmitting(false);
    }
  };

  const handleStartOver = () => {
    sessionStorage.removeItem(QUOTE_TOKEN_KEY);
    setStep('address');
    setGeocodeData(null);
    setGateDraft(null);
    setQuoteData(null);
    setGateError('');
  };

  useEffect(() => {
    const token = readStoredToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/roof/quote-reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.quote) {
          sessionStorage.removeItem(QUOTE_TOKEN_KEY);
          return;
        }
        if (typeof data.token === 'string') storeToken(data.token);
        setQuoteData(quoteFromPayload(data));
        setStep('quote');
      } catch {
        if (!cancelled) sessionStorage.removeItem(QUOTE_TOKEN_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isFramedWindow()) return;
    const root = document.documentElement;
    const post = () => notifyParentHeight(root.scrollHeight);
    const onPing = (event: MessageEvent) => {
      replyToParentPing(event, root.scrollHeight, window.parent);
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(root);
    window.addEventListener('resize', post);
    window.addEventListener('message', onPing);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', post);
      window.removeEventListener('message', onPing);
    };
  }, [step]);

  return (
    <>
    {!hideHeader && <NavBar />}
    <div className={step === 'quote' ? 'widget widget--quote' : 'widget'}>
      {!hideHeader && (
        <header className="header">
          <BrandLogo size="login" />
          <div className="header__tagline">Serving North Carolina since 2017</div>
        </header>
      )}

      {step === 'address' && (
        <AddressForm onGeocoded={handleGeocoded} />
      )}

      {step === 'confirm' && geocodeData && (
        <ConfirmAddress
          address={geocodeData.address}
          lat={geocodeData.lat}
          lng={geocodeData.lng}
          onConfirm={handleLocationConfirmed}
          onReject={handleNotMyHome}
        />
      )}

      {step === 'gate' && gateDraft && (
        <QuoteGate
          address={gateDraft.address}
          submitting={gateSubmitting}
          serverError={gateError}
          onSubmit={handleGateSubmit}
        />
      )}

      {step === 'quote' && quoteData && (
        <QuoteResult data={quoteData} onStartOver={handleStartOver} />
      )}

      <footer className="footer">
        © {new Date().getFullYear()}{' '}
        <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">
          K&amp;D Roofing NC
        </a>{' '}
        · Licensed &amp; Insured
      </footer>
    </div>
    </>
  );
}
