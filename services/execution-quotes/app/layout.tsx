import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Execution Market Quotes",
  description: "Read-only market prices with source timestamps.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
