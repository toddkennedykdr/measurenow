import { useEffect, ReactNode } from 'react';
import { NavBar } from './NavBar';

export function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · MeasureNow by K&D Roofing`;
    return () => { document.title = prev; };
  }, [title]);

  return (
    <>
      <NavBar />
      <main className="admin-page">
        <h1 className="admin-page__title">{title}</h1>
        <p className="admin-page__sub">{subtitle}</p>
        {children}
      </main>
    </>
  );
}
