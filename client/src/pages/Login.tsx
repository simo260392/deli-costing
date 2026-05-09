import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import logoWhite from "/logo-white.png";

export default function Login() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !password.trim()) {
      setError("Please enter your name and password");
      return;
    }
    setIsLoading(true);
    const result = await login(name.trim(), password);
    setIsLoading(false);
    if (!result.ok) {
      setError(result.error || "Invalid name or password");
    }
    // If ok, AuthContext updates staff state and App.tsx will redirect automatically
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#256984" }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img
            src={logoWhite}
            alt="The Deli by Greenhorns"
            className="w-48 h-auto object-contain"
            style={{ imageRendering: "-webkit-optimize-contrast" }}
          />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl px-8 py-8">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Sign in</h1>
          <p className="text-sm text-gray-500 mb-6">Enter your name and the shared password to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-name" className="block text-sm font-medium text-gray-700 mb-1">
                Your name
              </label>
              <input
                id="login-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                autoFocus
                data-testid="input-login-name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                style={{ "--tw-ring-color": "#256984" } as any}
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                data-testid="input-login-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
                style={{ "--tw-ring-color": "#256984" } as any}
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 font-medium" data-testid="text-login-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              data-testid="button-login-submit"
              className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ backgroundColor: "#256984" }}
            >
              {isLoading ? "Signing in…" : "Log in"}
            </button>
          </form>
        </div>

        <p className="text-center text-white/50 text-xs mt-6">
          The Deli by Greenhorns — Staff Portal
        </p>
      </div>
    </div>
  );
}
