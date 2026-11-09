import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

// The spike page prints hashes and block numbers in mono.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://akilii.xyz"),
  applicationName: "Akilii",
  title: "Akilii | The all-in-one savings app",
  description: "The all-in-one savings app. Save together in circles, lock goals away, or keep them in your own wallet, with Nimiq Pay.",
  openGraph: {
    siteName: "Akilii",
    title: "Akilii | The all-in-one savings app",
    description: "The all-in-one savings app. Save together in circles, lock goals away, or keep them in your own wallet, with Nimiq Pay.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#fff6f1",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Nimiq Pay injects safe-area CSS variables onto <html> before hydration.
    <html
      suppressHydrationWarning
      lang="en"
      className={`${bricolage.variable} ${figtree.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
