import type { Metadata } from 'next';
import { Geist, Geist_Mono, JetBrains_Mono, Press_Start_2P } from 'next/font/google';
import './globals.css';
import { VoiceProvider } from '@/contexts/VoiceContext';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

const pressStart2P = Press_Start_2P({
  variable: '--font-press-start-2p',
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SlyCode',
  description: 'SlyCode Managed Projects',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Inline script to set dark class before paint (prevents flash)
  const themeScript = `(function(){try{var t=localStorage.getItem('slycode-theme');if(t==='light')return;if(t==='dark'||window.matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}})()`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${pressStart2P.variable} font-sans antialiased`}
      >
        <VoiceProvider>{children}</VoiceProvider>
      </body>
    </html>
  );
}
