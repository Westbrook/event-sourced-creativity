import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Forma — An event-sourced creative studio",
    description: "Shape creative context as authored blocks, trace every inference, and return to work without losing the thread.",
    openGraph: {
      title: "Forma — An event-sourced creative studio",
      description: "Every creative decision stays editable, attributable, and alive.",
      type: "website",
      images: [{ url: imageUrl, width: 1731, height: 909, alt: "Forma — Every creative decision stays alive." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Forma — An event-sourced creative studio",
      description: "Every creative decision stays editable, attributable, and alive.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
