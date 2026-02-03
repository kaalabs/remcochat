import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "RemcoChat",
  description: "Minimal LAN chat app",
  applicationName: "RemcoChat",
  appleWebApp: {
    capable: true,
    title: "RemcoChat",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className="h-full overflow-hidden"
      lang="en"
      suppressHydrationWarning
    >
      <body
        className="h-full overflow-hidden antialiased"
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
