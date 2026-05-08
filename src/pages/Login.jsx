import { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { auth, db } from "../firebase";
import "./Login.css";

function generateCode(length = 6) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function Login() {
  // steps: "loading" | "home" | "create-room" | "create-name" | "created" | "join-code" | "join-name"
  const [step, setStep] = useState("loading");
  const [roomName, setRoomName] = useState("");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [generatedInviteCode, setGeneratedInviteCode] = useState("");
  const [generatedAdminCode, setGeneratedAdminCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const check = async () => {
      const snap = await getDoc(doc(db, "settings", "global"));
      setStep(snap.exists() ? "join-code" : "home");
    };
    check();
  }, []);

  // 방 만들기 - 방 이름 제출
  const handleCreateRoom = (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setGeneratedInviteCode(generateCode(6));
    setGeneratedAdminCode(generateCode(6));
    setStep("create-name");
  };

  // 방 만들기 - 이름 입력 후 생성
  const handleCreateFinish = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const credential = await signInAnonymously(auth);
      const uid = credential.user.uid;
      localStorage.setItem(`workout-name-${uid}`, name.trim());
      await setDoc(doc(db, "settings", "global"), {
        adminUid: uid,
        title: roomName.trim(),
        inviteCode: generatedInviteCode,
        adminCode: generatedAdminCode,
        startDate: new Date(),
      });
      setStep("created");
    } catch {
      setError("방 생성에 실패했어요. 다시 시도해주세요.");
      setLoading(false);
    }
  };

  // 코드로 참여 - 코드 확인
  const handleJoinCode = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDoc(doc(db, "settings", "global"));
      const data = snap.exists() ? snap.data() : {};
      const inviteCode = data.inviteCode || "";
      const adminCode = data.adminCode || "";

      if (joinCode.trim() === adminCode) {
        setStep("join-name-admin");
      } else if (joinCode.trim() === inviteCode) {
        setStep("join-name");
      } else {
        setError("코드가 올바르지 않아요.");
      }
    } catch {
      setError("오류가 발생했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 참여 - 이름 입력 후 입장
  const handleJoinFinish = async (e, isAdmin = false) => {
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

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === "loading") {
    return (
      <div className="login-wrap">
        <div className="login-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-icon">🏋️</div>
        <h1 className="login-title">운동 인증방</h1>
        <p className="login-sub">함께 운동하고, 함께 성장해요</p>

        {/* 홈 */}
        {step === "home" && (
          <div className="login-home-btns">
            <button className="login-btn" onClick={() => setStep("create-room")}>
              방 만들기
            </button>
            <button className="login-btn login-btn-outline" onClick={() => setStep("join-code")}>
              코드로 참여
            </button>
          </div>
        )}

        {/* 방 만들기 - 방 이름 */}
        {step === "create-room" && (
          <form className="login-form" onSubmit={handleCreateRoom}>
            <p className="login-form-label">방 이름을 입력해주세요</p>
            <input
              className="login-input"
              type="text"
              placeholder="예: 헬창들의 모임"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={20}
              autoFocus
            />
            <button className="login-btn" type="submit" disabled={!roomName.trim()}>
              다음
            </button>
            <button type="button" className="login-back" onClick={() => { setStep("home"); setError(""); }}>← 뒤로</button>
          </form>
        )}

        {/* 방 만들기 - 내 이름 */}
        {step === "create-name" && (
          <form className="login-form" onSubmit={handleCreateFinish}>
            <div className="admin-badge">👑 방장으로 입장</div>
            <p className="login-form-label">내 이름을 입력해주세요</p>
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
              {loading ? "생성 중..." : "방 만들기"}
            </button>
            <button type="button" className="login-back" onClick={() => { setStep("create-room"); setError(""); }}>← 뒤로</button>
          </form>
        )}

        {/* 방 생성 완료 */}
        {step === "created" && (
          <div className="login-form">
            <div className="created-success">🎉 방이 만들어졌어요!</div>
            <p className="login-form-label">팀원에게 초대 코드를 공유하세요</p>
            <div className="code-display">
              <span className="code-text">{generatedInviteCode}</span>
              <button type="button" className="code-copy-btn" onClick={() => handleCopy(generatedInviteCode)}>
                {copied ? "✓ 복사됨" : "복사"}
              </button>
            </div>
            <p className="code-hint">관리자 코드: <strong>{generatedAdminCode}</strong></p>
            <p className="code-hint-sub">관리자 코드는 기기 변경 시 관리자 권한 복구에 사용돼요. 따로 보관해주세요.</p>
            <button className="login-btn" onClick={() => {}}>
              시작하기
            </button>
          </div>
        )}

        {/* 코드로 참여 */}
        {step === "join-code" && (
          <form className="login-form" onSubmit={handleJoinCode}>
            <p className="login-form-label">초대 코드를 입력해주세요</p>
            <input
              className="login-input"
              type="text"
              placeholder="코드 입력"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            <button className="login-btn" type="submit" disabled={loading || !joinCode.trim()}>
              {loading ? "확인 중..." : "다음"}
            </button>
            <button type="button" className="login-back" onClick={() => { setStep("home"); setError(""); setJoinCode(""); }}>← 뒤로</button>
          </form>
        )}

        {/* 참여 - 이름 입력 (일반) */}
        {step === "join-name" && (
          <form className="login-form" onSubmit={(e) => handleJoinFinish(e, false)}>
            <p className="login-form-label">내 이름을 입력해주세요</p>
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
              {loading ? "입장 중..." : "입장하기"}
            </button>
            <button type="button" className="login-back" onClick={() => { setStep("join-code"); setError(""); setName(""); }}>← 뒤로</button>
          </form>
        )}

        {/* 참여 - 이름 입력 (관리자) */}
        {step === "join-name-admin" && (
          <form className="login-form" onSubmit={(e) => handleJoinFinish(e, true)}>
            <div className="admin-badge">👑 관리자로 입장</div>
            <p className="login-form-label">내 이름을 입력해주세요</p>
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
              {loading ? "입장 중..." : "입장하기"}
            </button>
            <button type="button" className="login-back" onClick={() => { setStep("join-code"); setError(""); setName(""); }}>← 뒤로</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default Login;
