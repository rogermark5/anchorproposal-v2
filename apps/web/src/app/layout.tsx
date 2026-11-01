import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { TimeZoneProvider } from '@/components/time-zone-settings';
import { Toaster } from 'sonner';
import './fonts/fonts.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'AnchorProposal - AI Resume Platform',
  description: 'AI-assisted resume tailoring and job application management',
  manifest: '/manifest.webmanifest',
  applicationName: 'AnchorProposal Web',
  icons: { icon: '/icons/app-192.png', apple: '/icons/app-192.png' },
};

export const viewport: Viewport = { themeColor: '#095d63' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AuthProvider>
          <TimeZoneProvider>{children}</TimeZoneProvider>
          <Toaster richColors position="top-right" closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}
