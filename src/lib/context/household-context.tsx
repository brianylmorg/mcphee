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
  setHouseholdId: (id: string | null) => void;
  isLoading: boolean;
}

const HouseholdContext = createContext<HouseholdContextType>({
  householdId: null,
  setHouseholdId: () => {},
  isLoading: true,
});

export function useHousehold() {
  return useContext(HouseholdContext);
}

export function HouseholdProvider({
  initialHouseholdId,
  children,
}: {
  initialHouseholdId: string | undefined;
  children: ReactNode;
}) {
  const [householdId, setHouseholdId] = useState<string | null>(
    initialHouseholdId || null
  );
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSetHouseholdId = (id: string | null) => {
    setHouseholdId(id);
    if (id) {
      document.cookie = `mcphee_hh=${id}; path=/; SameSite=Strict; Secure`;
    } else {
      document.cookie = "mcphee_hh=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    }
    router.refresh();
  };

  return (
    <HouseholdContext.Provider
      value={{
        householdId,
        setHouseholdId: handleSetHouseholdId,
        isLoading,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}
