"use client";

import { useState, useEffect } from "react";
import { useHousehold } from "@/lib/context/household-context";
import { useRouter } from "next/navigation";

export default function WelcomePage() {
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [babyName, setBabyName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [yourName, setYourName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [householdResult, setHouseholdResult] = useState<{
    householdId: string;
    inviteCode?: string;
    babyId?: string;
  } | null>(null);
  const { householdId, setHouseholdId, setUserId } = useHousehold();
  const router = useRouter();

  useEffect(() => {
    if (householdId) {
      router.replace("/dashboard");
    }
  }, [householdId, router]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: babyName || "Baby",
          birthDate: birthDate ? new Date(birthDate).getTime() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setHouseholdResult({ householdId: data.householdId, inviteCode: data.inviteCode, babyId: data.babyId });
    } catch (err) {
      setError("Failed to create household. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          inviteCode: inviteCode.toUpperCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setHouseholdResult({ householdId: data.householdId });
    } catch (err) {
      setError("Invalid invite code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yourName.trim()) return;
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get-or-create",
          name: yourName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const user = data.user || data;
      setUserId(user.id || null, user.name || yourName.trim());
      setHouseholdId(householdResult!.householdId);
      router.push("/dashboard");
    } catch (err) {
      setError("Failed to set name. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Name step after household created/joined
  if (householdResult) {
    return (
      <main className="min-h-dvh bg-cream flex items-start justify-center px-6 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-md">
          <div className="mb-10 text-left">
            <h1 className="font-display text-4xl text-terracotta mb-2">What&apos;s your name?</h1>
            <p className="text-warm-brown-light">Just a name — no account needed</p>
          </div>

          <form onSubmit={handleSetName} className="space-y-6">
            <div>
              <label htmlFor="caregiver-name" className="mb-2 block text-sm font-medium text-muted">Your name</label>
              <input
                id="caregiver-name"
                type="text"
                value={yourName}
                onChange={(e) => setYourName(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-lg bg-surface"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={isLoading || !yourName.trim()}
              className="w-full py-4 px-6 bg-terracotta-dark text-white font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors disabled:opacity-50"
            >
              {isLoading ? "Saving…" : "Continue"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-cream flex items-start justify-center px-6 py-10 sm:items-center sm:py-16">
      <div className="w-full max-w-md">
        <div className="mb-10 text-left">
          <h1 className="font-display text-5xl text-terracotta mb-2">mcphee</h1>
          <p className="text-warm-brown-light text-lg">Track baby activities together</p>
        </div>

        {mode === "choose" && (
          <div className="space-y-4">
            <button
              onClick={() => setMode("create")}
              className="w-full py-4 px-6 bg-terracotta-dark text-white font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors"
            >
              Create a household
            </button>
            <button
              onClick={() => setMode("join")}
              className="w-full py-4 px-6 bg-surface text-accent-strong font-medium rounded-lg text-lg border border-accent-strong hover:bg-cream transition-colors"
            >
              Join with invite code
            </button>
          </div>
        )}

        {mode === "create" && (
          <form onSubmit={handleCreate} className="space-y-6">
            <div>
              <label htmlFor="baby-name" className="block text-sm font-medium text-warm-brown-light mb-2">
                Baby&apos;s name (optional)
              </label>
              <input
                id="baby-name"
                type="text"
                value={babyName}
                onChange={(e) => setBabyName(e.target.value)}
                placeholder="What should we call baby?"
                className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-lg bg-surface"
              />
            </div>
            <div>
              <label htmlFor="birth-date" className="block text-sm font-medium text-warm-brown-light mb-2">
                Birth date (optional)
              </label>
              <input
                id="birth-date"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-lg bg-surface"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 px-6 bg-terracotta-dark text-white font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors disabled:opacity-50"
            >
              {isLoading ? "Creating…" : "Create household"}
            </button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="w-full py-3 text-warm-brown-light hover:text-warm-brown"
            >
              Back
            </button>
          </form>
        )}

        {mode === "join" && (
          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label htmlFor="invite-code" className="block text-sm font-medium text-warm-brown-light mb-2">
                6-character invite code
              </label>
              <input
                id="invite-code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-lg bg-surface text-center font-mono"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={isLoading || inviteCode.length !== 6}
              className="w-full py-4 px-6 bg-terracotta-dark text-white font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors disabled:opacity-50"
            >
              {isLoading ? "Joining…" : "Join household"}
            </button>
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="w-full py-3 text-warm-brown-light hover:text-warm-brown"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </main>
  );
}