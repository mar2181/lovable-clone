import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ClerkProvider } from "@/lib/dev-auth";
import { PetConcierge } from "@/components/pet-concierge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "HS Solutions App & Web Builder",
  description: "HS Solutions app and web builder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark" suppressHydrationWarning>
        <body className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} min-h-screen bg-background font-sans antialiased flex flex-col`}>
          {children}
          <PetConcierge />
        </body>
      </html>
    </ClerkProvider>
  );
}
