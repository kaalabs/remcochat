import type { Metadata, Viewport } from "next";
import { headers, cookies } from "next/headers";
import { I18nProvider } from "@/components/i18n-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { detectUiLanguageFromAcceptLanguage } from "@/lib/i18n";
import { listProfiles } from "@/server/profiles";
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

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const seedUiLanguage = detectUiLanguageFromAcceptLanguage(
    headerStore.get("accept-language")
  );
  const profiles = listProfiles({ seedUiLanguage });

  const cookieStore = await cookies();
  const storedProfileId = cookieStore.get("remcochat_profile_id")?.value ?? "";
  const activeProfile =
    profiles.find((p) => p.id === storedProfileId) ?? profiles[0] ?? null;

  const initialUiLanguage = activeProfile?.uiLanguage ?? seedUiLanguage;

  return (
    <html
      className="h-full overflow-hidden"
      lang={initialUiLanguage}
      suppressHydrationWarning
    >
      <body
        className="h-full overflow-hidden antialiased"
      >
        <ThemeProvider>
          <I18nProvider initialUiLanguage={initialUiLanguage}>
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
