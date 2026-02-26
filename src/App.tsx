import { useState } from 'react';
import type { QuoteResponse, Step } from './types';
import { AddressForm } from './components/AddressForm';
import { ConfirmAddress } from './components/ConfirmAddress';
import { QuoteResult } from './components/QuoteResult';
import { ThankYou } from './components/ThankYou';

export default function App() {
  const [step, setStep] = useState<Step>('address');
  const [quoteData, setQuoteData] = useState<QuoteResponse | null>(null);
  const [leadName, setLeadName] = useState('');

  const handleQuoteReceived = (data: QuoteResponse) => {
    setQuoteData(data);
    setStep('confirm');
  };

  const handleConfirmed = () => {
    setStep('quote');
  };

  const handleNotMyHome = () => {
    setStep('address');
    setQuoteData(null);
  };

  const handleLeadSubmitted = (name: string) => {
    setLeadName(name);
    setStep('thankyou');
  };

  const handleStartOver = () => {
    setStep('address');
    setQuoteData(null);
    setLeadName('');
  };

  return (
    <div className="widget">
      <header className="header">
        <div className="header__logo">
          K&amp;D <span>Roofing</span>
        </div>
        <div className="header__tagline">Serving North Carolina since 2018</div>
      </header>

      {step === 'address' && (
        <AddressForm onQuoteReceived={handleQuoteReceived} />
      )}

      {step === 'confirm' && quoteData && (
        <ConfirmAddress data={quoteData} onConfirm={handleConfirmed} onReject={handleNotMyHome} />
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
