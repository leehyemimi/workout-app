import { signInWithPopup } from "firebase/auth";
import { auth, provider } from "../firebase";
import "./Login.css";

function Login() {
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
      // 로그인 성공 → App.jsx에서 자동으로 메인 화면으로 이동해요
    } catch (error) {
      console.error("로그인 실패:", error);
      alert("로그인에 실패했어요. 다시 시도해주세요.");
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-icon">🏋️</div>
        <h1 className="login-title">운동 인증 앱</h1>
        <p className="login-sub">함께 운동하고, 함께 성장해요</p>

        <div className="login-info">
          <div className="info-row">
            <span className="info-dot" />
            일주일 단위 운동 인증
          </div>
          <div className="info-row">
            <span className="info-dot" />
            사진 촬영으로 인증
          </div>
          <div className="info-row">
            <span className="info-dot" />
            미달성 시 벌금 1만원
          </div>
        </div>

        <button className="google-btn" onClick={handleGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Google로 로그인
        </button>

        <p className="login-notice">
          팀원 4명 모두 이 링크로 접속해서 로그인하면 돼요
        </p>
      </div>
    </div>
  );
}

export default Login;
