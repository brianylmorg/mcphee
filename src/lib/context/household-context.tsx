"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";

interface HouseholdContextType {
  householdId: string | null;
  userId: string | null;
  userName: string | null;
  setHouseholdId: (id: string | null) => void;
  setUserId: (id: string | null, name: string | null) => void;
  isLoading: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
  householdId: null,
  userId: null,
  userName: null,
  setHouseholdId: () => {},
  setUserId: () => {},
  isLoading: true,
});

export function useHousehold() {
  return useContext(HouseholdContext);
}

export function HouseholdProvider({
  initialHouseholdId,
  initialUserId,
  initialUserName,
  children,
}: {
  initialHouseholdId: string | undefined;
  initialUserId: string | undefined;
  initialUserName: string | undefined;
  children: ReactNode;
}) {
  const [householdId, setHouseholdIdState] = useState<string | null>(
    initialHouseholdId || null
  );
  const [userId, setUserIdState] = useState<string | null>(initialUserId || null);
  const [userName, setUserNameState] = useState<string | null>(initialUserName || null);
  const [profileRevision, setProfileRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setUserNameState(null);
      return;
    }

    fetch("/api/users", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setUserNameState(data.user?.name ?? null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [userId, profileRevision]);

  const setHouseholdId = (id: string | null) => {
    setHouseholdIdState(id);
    router.refresh();
  };

  const setUserId = (id: string | null, name: string | null) => {
    setUserIdState(id);
    setUserNameState(name);
    setProfileRevision((revision) => revision + 1);
  };

  return (
    <HouseholdContext.Provider
      value={{
        householdId,
        userId,
        userName,
        setHouseholdId,
        setUserId,
        isLoading,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}