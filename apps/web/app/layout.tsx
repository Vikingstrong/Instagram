import { CallsProvider } from "@/features/calls/calls-provider";
import { LiveAlerts } from "@/features/live/live-alerts";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/geist/Geist-Variable.ttf",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geistmono/GeistMono-Variable.ttf",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

// Script face for the "Instagram" wordmark.
const grandHotel = localFont({
  src: "./fonts/grandhotel/GrandHotel-Regular.ttf",
  variable: "--font-grand-hotel",
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Instagram",
  description: "Instagram Clone",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} ${grandHotel.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><CallsProvider>{children}<LiveAlerts /></CallsProvider></body>
    </html>
  );
}
