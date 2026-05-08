import { useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "../firebase";
import "./Login.css";

const DEFAULT_CODE = "workout";
const DEFAULT_ADMIN_CODE = "admin1234";

function Login() {
  const [step, setStep] = useState("code"); // "code" | "admin-code" | "name"
  const [isAdmin, setIsAdmin] = useState(false);
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
      const data = snap.exists() ? snap.data() : {};
      const inviteCode = data.inviteCode || DEFAULT_CODE;
      const adminCode = data.adminCode || DEFAULT_ADMIN_CODE;

      if (code.trim() === adminCode) {
        setIsAdmin(true);
        setCode("");
        setStep("name");
      } else if (code.trim() === inviteCode) {
        setIsAdmin(false);
        setCode("");
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
      const uid = credential.user.uid;
      localStorage.setItem(`workout-name-${uid}`, name.trim());
      if (isAdmin) {
        await setDoc(doc(db, "settings", "global"), { adminUid: uid }, { merge: true });
      }
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

        {step === "code" && (
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
        )}

        {step === "name" && (
          <form className="login-form" onSubmit={handleNameSubmit}>
            {isAdmin && <div className="admin-badge">👑 관리자로 입장</div>}
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
            <button type="button" className="login-back" onClick={() => { setStep("code"); setError(""); }}>
              ← 뒤로
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
