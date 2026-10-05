import type { Metadata } from "next";
import { Header, Footer } from "@/components/chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "BDR Agent / Ramp",
  description: "Explore Canadian federal corporation records imported into a local searchable directory.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><Header />{children}<Footer /></body></html>;
}
