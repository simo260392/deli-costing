import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface AccessLevel {
  id: number;
  name: string;
  pagesJson: string[];
}

export interface StaffMember {
  id: number;
  name: string;
  accessLevel: AccessLevel;
}

interface AuthContextValue {
  staff: StaffMember | null;
  isLoading: boolean;
  login: (name: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasAccess: (slug: string) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  staff: null,
  isLoading: true,
  login: async () => ({ ok: false }),
  logout: async () => {},
  hasAccess: () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: restore session via GET /api/auth/me
  useEffect(() => {
    apiRequest("GET", "/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.staff) {
          setStaff(data.staff);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (name: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await apiRequest("POST", "/api/auth/login", { name, password });
      const data = await r.json();
      if (data.ok && data.staff) {
        setStaff(data.staff);
        return { ok: true };
      }
      return { ok: false, error: data.error || "Invalid name or password" };
    } catch (err: any) {
      return { ok: false, error: "Network error" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
    setStaff(null);
  }, []);

  const hasAccess = useCallback(
    (slug: string): boolean => {
      if (!staff) return false;
      // Admin (access level named "Admin") always has access
      if (staff.accessLevel.name === "Admin") return true;
      return staff.accessLevel.pagesJson.includes(slug);
    },
    [staff]
  );

  return (
    <AuthContext.Provider value={{ staff, isLoading, login, logout, hasAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
