import type { Metadata } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Figma to SitecoreAI | Component Studio",
  description: "Turn Figma designs into SitecoreAI component definitions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
