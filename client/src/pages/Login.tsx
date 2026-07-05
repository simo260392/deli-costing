import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import logoWhite from "/logo-white.png";
import { Delete } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = useCallback(async (pinValue: string) => {
    if (!name.trim()) {
      setError("Please enter your name");
      setPin("");
      return;
    }
    if (pinValue.length < 4) return;

    setError("");
    setIsLoading(true);
    const result = await login(name.trim(), pinValue);
    setIsLoading(false);

    if (!result.ok) {
      setShake(true);
      setPin("");
      setTimeout(() => setShake(false), 600);
      setError("Incorrect PIN");
    }
  }, [name, login]);

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4) {
      handleSubmit(pin);
    }
  }, [pin, handleSubmit]);

  // Physical keyboard support
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        setPin(prev => prev.length < 4 ? prev + e.key : prev);
      } else if (e.key === "Backspace") {
        setPin(prev => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        if (pin.length === 4) handleSubmit(pin);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pin, handleSubmit]);

  const pressDigit = (d: string) => {
    setError("");
    setPin(prev => prev.length < 4 ? prev + d : prev);
  };

  const deleteLast = () => setPin(prev => prev.slice(0, -1));

  const digits = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "#256984" }}
    >
      <div className="w-full max-w-xs">
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
        <div className="bg-white rounded-2xl shadow-xl px-7 py-8">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Sign in</h1>
          <p className="text-sm text-gray-500 mb-5">Enter your name then your PIN.</p>

          {/* Name field */}
          <div className="mb-5">
            <label htmlFor="login-name" className="block text-sm font-medium text-gray-700 mb-1">
              Your name
            </label>
            <input
              id="login-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
              data-testid="input-login-name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-shadow"
              style={{ "--tw-ring-color": "#256984" } as any}
            />
          </div>

          {/* PIN dots */}
          <div className="flex justify-center gap-4 mb-5">
            {[0,1,2,3].map(i => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                  pin.length > i
                    ? "border-[#256984] bg-[#256984]"
                    : "border-gray-300 bg-white"
                } ${shake ? "animate-bounce" : ""}`}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 font-medium text-center mb-3" data-testid="text-login-error">
              {error}
            </p>
          )}

          {/* Keypad */}
          <div className={`grid grid-cols-3 gap-2 ${shake ? "opacity-50" : ""}`}>
            {digits.map((d, i) => {
              if (d === "") return <div key={i} />;
              if (d === "⌫") return (
                <button
                  key={i}
                  type="button"
                  onClick={deleteLast}
                  disabled={isLoading}
                  data-testid="button-pin-delete"
                  className="flex items-center justify-center h-14 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-95 transition-all disabled:opacity-40 text-lg"
                >
                  <Delete size={20} />
                </button>
              );
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pressDigit(d)}
                  disabled={isLoading || pin.length >= 4}
                  data-testid={`button-pin-${d}`}
                  className="flex items-center justify-center h-14 rounded-xl bg-gray-100 text-gray-900 font-semibold text-xl hover:bg-gray-200 active:scale-95 transition-all disabled:opacity-40"
                >
                  {d}
                </button>
              );
            })}
          </div>

          {isLoading && (
            <p className="text-center text-sm text-gray-400 mt-4">Signing in…</p>
          )}
        </div>

        <p className="text-center text-white/50 text-xs mt-6">
          The Deli by Greenhorns — Staff Portal
        </p>
      </div>
    </div>
  );
}
