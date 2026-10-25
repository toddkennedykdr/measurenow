import { HONEYPOT_FIELD } from '../publicFormGuard';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/** Off-screen field. People never see it. Automated fills tend to type in it. */
export function HoneypotField({ id, value, onChange }: Props) {
  return (
    <div className="hp-field" aria-hidden="true">
      <label htmlFor={id}>Company website</label>
      <input
        id={id}
        name={HONEYPOT_FIELD}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );
}
