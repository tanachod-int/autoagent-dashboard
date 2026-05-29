import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoAgent Dashboard - AI Operations Panel",
  description: "Interactive Text-to-SQL Multi-Agent Pipeline Control Panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
