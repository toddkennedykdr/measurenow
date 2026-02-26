import { useState } from 'react';
import { NavBar } from './components/NavBar';
import type { GeocodeResponse, FullQuoteData, Step } from './types';
import { AddressForm } from './components/AddressForm';
import { ConfirmAddress } from './components/ConfirmAddress';
import { QuoteResult } from './components/QuoteResult';
import { ThankYou } from './components/ThankYou';

export default function App() {
  const [step, setStep] = useState<Step>('address');
  const [geocodeData, setGeocodeData] = useState<GeocodeResponse | null>(null);
  const [quoteData, setQuoteData] = useState<FullQuoteData | null>(null);
  const [leadName, setLeadName] = useState('');

  const handleGeocoded = (data: GeocodeResponse) => {
    setGeocodeData(data);
    setStep('confirm');
  };

  const handleLocationConfirmed = async (lat: number, lng: number) => {
    // Call quote API with confirmed coordinates
    const res = await fetch('/api/roof/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get quote');
    setQuoteData({ ...data, address: geocodeData!.address });
    setStep('quote');
  };

  const handleNotMyHome = () => {
    setStep('address');
    setGeocodeData(null);
    setQuoteData(null);
  };

  const handleLeadSubmitted = (name: string) => {
    setLeadName(name);
    setStep('thankyou');
  };

  const handleStartOver = () => {
    setStep('address');
    setGeocodeData(null);
    setQuoteData(null);
    setLeadName('');
  };

  return (
    <div className="widget">
      <NavBar />
      <header className="header">
        <div className="header__logo">
          K&amp;D <span>Roofing</span>
        </div>
        <div className="header__tagline">Serving North Carolina since 2018</div>
      </header>

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

      {step === 'quote' && quoteData && (
        <QuoteResult data={quoteData} onLeadSubmitted={handleLeadSubmitted} />
      )}

      {step === 'thankyou' && quoteData && (
        <ThankYou name={leadName} data={quoteData} onStartOver={handleStartOver} />
      )}

      <footer className="footer">
        © {new Date().getFullYear()}{' '}
        <a href="https://kanddroofingnc.com" target="_blank" rel="noopener">
          K&amp;D Roofing NC
        </a>{' '}
        · Licensed &amp; Insured
      </footer>
    </div>
  );
}
