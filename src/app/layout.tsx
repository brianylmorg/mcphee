import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { HouseholdProvider } from "@/lib/context/household-context";
import { createDB } from "@/db";

export const metadata: Metadata = {
  title: "mcphee — Baby Activity Tracker",
  description: "Track your baby's activities together",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "mcphee",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#C4785A",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const householdId = cookieStore.get("mcphee_hh")?.value;
  const userId = cookieStore.get("mcphee_user")?.value;

  let userName: string | undefined;
  if (userId) {
    try {
      const db = createDB();
      const result = await db.execute({ sql: "SELECT name FROM users WHERE id = ?", args: [userId] });
      if (result.rows.length > 0) {
        userName = (result.rows[0] as unknown as { name: string }).name;
      }
    } catch {}
  }

  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-cream text-warm-brown antialiased">
        <HouseholdProvider
          initialHouseholdId={householdId}
          initialUserId={userId}
          initialUserName={userName}
        >
          {children}
        </HouseholdProvider>
      </body>
    </html>
  );
}