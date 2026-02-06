import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Duma Speaking Trainer",
  description: "AI speaking practice for Kenyan students",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
