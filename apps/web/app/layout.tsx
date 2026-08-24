import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import { DemoStateProvider } from "../components/demo-state";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Influencer Travel Marketplace",
  description: "Discover and create practical travel itineraries.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} h-full antialiased`}
      style={
        {
          "--fc-font-body": "var(--font-roboto)",
          "--fc-font-display": "var(--font-roboto)",
        } as CSSProperties
      }
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body
        className="min-h-full flex flex-col"
        style={{ fontFamily: "var(--font-roboto), sans-serif", margin: 0 }}
      >
        <DemoStateProvider>
          {children}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                fontFamily: "var(--font-roboto), sans-serif",
                borderRadius: "10px",
              },
            }}
          />
        </DemoStateProvider>
      </body>
    </html>
  );
}
