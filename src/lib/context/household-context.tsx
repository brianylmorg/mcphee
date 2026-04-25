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

  const setHouseholdId = (id: string | null) => {
    setHouseholdIdState(id);
    router.refresh();
  };

  const setUserId = (id: string | null, name: string | null) => {
    setUserIdState(id);
    setUserNameState(name);
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