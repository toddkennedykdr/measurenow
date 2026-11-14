import { useState, type FormEvent } from 'react';

interface Props {
  address: string;
  submitting: boolean;
  serverError: string;
  onSubmit: (fields: { name: string; email: string; phone: string; address: string }) => void;
}

type FieldErrors = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

/** Same US check as the server gate: 10 digits, optional leading 1, area and exchange codes 2-9. */
export function usPhoneDigits(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
  return national;
}

function fieldErrors(fields: { name: string; email: string; phone: string; address: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.name.trim()) errors.name = 'Name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = 'Please enter a valid email.';
  if (!usPhoneDigits(fields.phone)) errors.phone = 'Please enter a valid US phone number.';
  if (fields.address.trim().length < 5) errors.address = 'Please enter a valid address.';
  return errors;
}

export function QuoteGate({ address, submitting, serverError, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [propertyAddress, setPropertyAddress] = useState(address);
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const fields = { name, email, phone, address: propertyAddress };
    const next = fieldErrors(fields);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      address: propertyAddress.trim(),
    });
  };

  return (
    <div className="card">
      <h1 className="card__title">See your estimate</h1>
      <p className="card__subtitle">
        Enter your contact info and address to view your K&amp;D Roofing estimate.
      </p>

      {serverError && <div className="error-msg">{serverError}</div>}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="gate-name">Full Name</label>
          <input
            id="gate-name"
            type="text"
            className={errors.name ? 'input input--error' : 'input'}
            placeholder="Jane Homeowner"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'gate-name-error' : undefined}
          />
          {errors.name && <p id="gate-name-error" className="field-error">{errors.name}</p>}
        </div>
        <div className="form-group">
          <label htmlFor="gate-phone">Phone</label>
          <input
            id="gate-phone"
            type="tel"
            className={errors.phone ? 'input input--error' : 'input'}
            placeholder="(919) 555-0134"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={submitting}
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? 'gate-phone-error' : undefined}
          />
          {errors.phone && <p id="gate-phone-error" className="field-error">{errors.phone}</p>}
        </div>
        <div className="form-group">
          <label htmlFor="gate-email">Email</label>
          <input
            id="gate-email"
            type="email"
            className={errors.email ? 'input input--error' : 'input'}
            placeholder="jane@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'gate-email-error' : undefined}
          />
          {errors.email && <p id="gate-email-error" className="field-error">{errors.email}</p>}
        </div>
        <div className="form-group">
          <label htmlFor="gate-address">Property Address</label>
          <input
            id="gate-address"
            type="text"
            className={errors.address ? 'input input--error' : 'input'}
            value={propertyAddress}
            onChange={(event) => setPropertyAddress(event.target.value)}
            disabled={submitting}
            autoComplete="street-address"
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={errors.address ? 'gate-address-error' : undefined}
          />
          {errors.address && <p id="gate-address-error" className="field-error">{errors.address}</p>}
        </div>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting && <span className="spinner" />}
          {submitting ? 'Submitting...' : 'View My Estimate'}
        </button>
      </form>
    </div>
  );
}
