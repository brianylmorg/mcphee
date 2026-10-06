import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { HouseholdProvider } from "@/lib/context/household-context";
import { createDB } from "@/db";
import CareModeTheme from "@/components/CareModeTheme";
import { cache } from "react";

export const metadata: Metadata = {
  title: "mcphee — Baby Activity Tracker",
  description: "Track your baby's activities together",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "mcphee",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

const readCareMode = cache(async () => {
  const cookieStore = await cookies();
  const householdId = cookieStore.get("mcphee_hh")?.value;
  if (householdId) {
    try {
      const result = await createDB().execute({
        sql: `SELECT b.id, EXISTS(SELECT 1 FROM sick_mode_episodes e WHERE e.baby_id=b.id AND e.ended_at IS NULL) AS care_active
              FROM babies b WHERE b.household_id=? LIMIT 1`,
        args: [householdId],
      });
      if (result.rows[0]) return { babyId: String(result.rows[0].id), active: Number(result.rows[0].care_active) === 1 };
    } catch {
      // Older databases remain usable before the additive sick-mode migration.
    }
  }
  return { babyId: undefined, active: false };
});

export async function generateViewport(): Promise<Viewport> {
  const careMode = await readCareMode();
  return { themeColor: careMode.active ? "#356B76" : "#A85D3F" };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const householdId = cookieStore.get("mcphee_hh")?.value;
  const userId = cookieStore.get("mcphee_user")?.value;

  let userName: string | undefined;
  const { babyId: initialBabyId, active: initialCareMode } = await readCareMode();
  if (userId && householdId) {
    try {
      const db = createDB();
      const result = await db.execute({
        sql: "SELECT name FROM users WHERE id = ? AND household_id = ? LIMIT 1",
        args: [userId, householdId],
      });
      if (result.rows.length > 0) {
        userName = (result.rows[0] as unknown as { name: string }).name;
      }
    } catch {}
  }

  return (
    <html lang="en" data-care-mode={initialCareMode ? "sick" : undefined} suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-cream text-warm-brown antialiased">
        <HouseholdProvider
          initialHouseholdId={householdId}
          initialUserId={userId}
          initialUserName={userName}
        >
          <CareModeTheme initialHouseholdId={householdId} initialBabyId={initialBabyId} initialActive={initialCareMode} />
          {children}
        </HouseholdProvider>
      </body>
    </html>
  );
}
