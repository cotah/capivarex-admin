import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CAPIVAREX Admin',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className="dark">
      <body className="bg-[#0a0a0f] text-white antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
