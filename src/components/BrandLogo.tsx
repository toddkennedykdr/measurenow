type LogoSize = 'header' | 'login';

const SOURCES: Record<LogoSize, { webp: string; png: string }> = {
  header: { webp: '/brand/logo-header.webp', png: '/brand/logo-header.png' },
  login: { webp: '/brand/logo-login.webp', png: '/brand/logo-login.png' },
};

/** Official K&D mark. One dimension is set in CSS so the artwork is never stretched. */
export function BrandLogo({ size = 'header' }: { size?: LogoSize }) {
  const src = SOURCES[size];
  return (
    <picture className={`brand-logo brand-logo--${size}`}>
      <source srcSet={src.webp} type="image/webp" />
      <img src={src.png} alt="K&D Roofing" />
    </picture>
  );
}
