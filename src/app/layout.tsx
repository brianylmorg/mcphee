import type { Metadata } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { HouseholdProvider } from "@/lib/context/household-context";

export const metadata: Metadata = {
  title: "mcphee — Baby Activity Tracker",
  description: "Track your baby's activities together",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const householdId = cookieStore.get("mcphee_hh")?.value;
  const userId = cookieStore.get("mcphee_user")?.value;

  return (
    <html lang="en">
      <body className="bg-cream text-warm-brown antialiased">
        <HouseholdProvider 
          initialHouseholdId={householdId}
          initialUserId={userId}
          initialUserName={undefined}
        >
          {children}
        </HouseholdProvider>
      </body>
    </html>
  );
}