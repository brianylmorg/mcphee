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
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const isProd = process.env.NODE_ENV === "production";

  const setHouseholdId = (id: string | null) => {
    setHouseholdIdState(id);
    if (id) {
      document.cookie = `mcphee_hh=${id}; path=/; SameSite=Strict;${isProd ? " Secure;" : ""} max-age=${60 * 60 * 24 * 365}`;
    } else {
      document.cookie = "mcphee_hh=; path=/; SameSite=Strict; max-age=0";
    }
    router.refresh();
  };

  const setUserId = (id: string | null, name: string | null) => {
    setUserIdState(id);
    setUserNameState(name);
    if (id) {
      document.cookie = `mcphee_user=${id}; path=/; SameSite=Strict;${isProd ? " Secure;" : ""} max-age=${60 * 60 * 24 * 365}`;
    } else {
      document.cookie = "mcphee_user=; path=/; SameSite=Strict; max-age=0";
    }
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