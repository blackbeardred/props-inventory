import type { Metadata, Viewport } from "next";
import { Courier_Prime, Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/service-worker";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

// Propolis: the quiet mono that carries meta lines, field labels and data
// values. Not a third voice for prose — it marks the things that are read as
// records rather than as sentences.
const courierPrime = Courier_Prime({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// viewport-fit=cover is what makes env(safe-area-inset-bottom) report the
// iPhone home indicator's height, which the phone tab bar pads itself by.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The status bar on Android, and the title bar of the installed app on a
  // desktop: ink, like the icon.
  themeColor: "#2A2219",
};

export const metadata: Metadata = {
  title: "Props & Costume Inventory",
  description: "Track props, costumes, storage locations, and pull lists.",
  // Opened from an iPhone home screen, run full screen rather than as a
  // Safari tab. The manifest (app/manifest.ts) does the same for Android.
  appleWebApp: {
    capable: true,
    title: "Props",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${courierPrime.variable} h-full antialiased`}
    >
      {/* The honeycomb texture lives on the body so every page carries the
          same ground, rather than each panel drawing its own. */}
      <body className="honeycomb min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
