import { useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "../firebase";
import "./Login.css";

const DEFAULT_CODE = "workout";

function Login() {
  const [step, setStep] = useState("code"); // "code" | "name"
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDoc(doc(db, "settings", "global"));
      const inviteCode = snap.exists() && snap.data().inviteCode
        ? snap.data().inviteCode
        : DEFAULT_CODE;
      if (code.trim() === inviteCode) {
        setStep("name");
      } else {
        setError("코드가 올바르지 않아요.");
      }
    } catch {
      setError("오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const credential = await signInAnonymously(auth);
      // 이름은 Main.jsx의 initUser에서 Firestore에 저장됨
      // localStorage에 미리 저장해두면 initUser가 읽어서 사용
      localStorage.setItem(`workout-name-${credential.user.uid}`, name.trim());
    } catch {
      setError("입장에 실패했어요. 다시 시도해주세요.");
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-icon">🏋️</div>
        <h1 className="login-title">운동 인증방</h1>
        <p className="login-sub">함께 운동하고, 함께 성장해요</p>

        {step === "code" ? (
          <form className="login-form" onSubmit={handleCodeSubmit}>
            <p className="login-form-label">입장 코드를 입력해주세요</p>
            <input
              className="login-input"
              type="text"
              placeholder="코드 입력"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            <button className="login-btn" type="submit" disabled={loading || !code.trim()}>
              {loading ? "확인 중..." : "입장하기"}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleNameSubmit}>
            <p className="login-form-label">이름을 입력해주세요</p>
            <input
              className="login-input"
              type="text"
              placeholder="홍길동"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={10}
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            <button className="login-btn" type="submit" disabled={loading || !name.trim()}>
              {loading ? "입장 중..." : "시작하기"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
