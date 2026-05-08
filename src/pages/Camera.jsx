import { useState, useRef, useEffect } from "react";
import { ref } from "firebase/storage";
import { collection, addDoc, updateDoc, doc, Timestamp } from "firebase/firestore";
import { storage, db } from "../firebase";
import "./Camera.css";

// 현재 주차 구하기 (예: "2026-W19")
function getWeekId() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 타임스탬프 포맷 (두 줄)
function formatDateTime(d) {
  const ampm = d.getHours() < 12 ? "오전" : "오후";
  const h = d.getHours() % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, "0");
  const timeLine = `${ampm} ${h}:${mi}`;
  const dateLine = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
  return { timeLine, dateLine };
}

function Camera({ user, userName, editingCert, certMethod = 1, photoIndex = null, onBack, onSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const tsIntervalRef = useRef(null);

  const [status, setStatus] = useState("idle"); // idle | streaming | preview | uploading | done
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedTime, setCapturedTime] = useState(null);
  const [tsDisplay, setTsDisplay] = useState({ timeLine: "", dateLine: "" });
  const [error, setError] = useState("");

  // 컴포넌트가 사라질 때 카메라 끄기
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      setStatus("streaming");

      // 타임스탬프 1초마다 업데이트
      tsIntervalRef.current = setInterval(() => {
        setTsDisplay(formatDateTime(new Date()));
      }, 1000);
      setTsDisplay(formatDateTime(new Date()));

    } catch (err) {
      setError("카메라를 열 수 없어요. 브라우저에서 카메라 권한을 허용해 주세요.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    clearInterval(tsIntervalRef.current);
  };

  // 사진 촬영 + 타임스탬프 합성
  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const now = new Date();
    const { timeLine, dateLine } = formatDateTime(now);

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const timeFontSize = Math.max(Math.floor(canvas.width / 9), 36);
    const dateFontSize = Math.max(Math.floor(canvas.width / 22), 16);
    const padding = 20;
    const dateY = canvas.height - padding;
    const timeY = dateY - dateFontSize * 1.4;

    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 10;

    // 날짜 (작은 글씨, 흰색, Jua) - 먼저 그려서 아래에
    ctx.font = `${dateFontSize}px 'Jua', sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(dateLine, padding, dateY);

    // 시간 (큰 글씨, 흰색, Jua)
    ctx.font = `${timeFontSize}px 'Jua', sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(timeLine, padding, timeY);

    // 2장 인증 시 번호 표시 (하단 중앙)
    if (certMethod === 2 && photoIndex) {
      const badgeFontSize = Math.max(Math.floor(canvas.width / 18), 20);
      const badgeText = `${photoIndex} / ${certMethod}`;
      ctx.font = `bold ${badgeFontSize}px 'Jua', sans-serif`;
      ctx.textAlign = "right";
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(badgeText, canvas.width - padding, canvas.height - padding);
      ctx.shadowBlur = 0;
    }
    ctx.textAlign = "left";

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(dataUrl);
    setCapturedTime(now);
    stopCamera();
    setStatus("preview");
  };

  // Firebase에 업로드
  const uploadPhoto = async () => {
    if (!capturedImage) return;
    setStatus("uploading");

    try {
      // 1. Storage에 사진 저장
      const fileName = `photos/${user.uid}/${Date.now()}.jpg`;
      const storageRef = ref(storage, fileName);

      // dataUrl → blob 변환
      const res = await fetch(capturedImage);
      const blob = await res.blob();
      const { uploadBytes, getDownloadURL } = await import("firebase/storage");
      const snapshot = await uploadBytes(storageRef, blob);
      const imageUrl = await getDownloadURL(snapshot.ref);

      // 2. Firestore에 인증 기록 저장 (수정 or 신규)
      if (editingCert) {
        await updateDoc(doc(db, "certifications", editingCert.id), {
          imageUrl,
          storagePath: fileName,
          createdAt: Timestamp.fromDate(new Date()),
        });
        if (editingCert.storagePath) {
          const { deleteObject, ref: storageRef } = await import("firebase/storage");
          try { await deleteObject(storageRef(storage, editingCert.storagePath)); } catch (e) { console.warn(e); }
        }
      } else {
        await addDoc(collection(db, "certifications"), {
          uid: user.uid,
          userName: userName,
          imageUrl,
          storagePath: fileName,
          week: getWeekId(),
          createdAt: Timestamp.fromDate(new Date()),
        });
      }

      setStatus("done");
      setTimeout(() => onSuccess(), 1500);
    } catch (err) {
      console.error(err);
      setError("업로드에 실패했어요. 다시 시도해주세요.");
      setStatus("preview");
    }
  };

  const retake = () => {
    setCapturedImage(null);
    setStatus("idle");
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  return (
    <div className="camera-wrap">
      {/* 헤더 */}
      <header className="camera-header">
        <button className="back-btn" onClick={onBack}>← 뒤로</button>
        <span className="camera-title">운동 인증 촬영</span>
        <span />
      </header>

      <div className="camera-body">
        {/* 완료 화면 */}
        {status === "done" && (
          <div className="done-screen">
            <div className="done-icon">✓</div>
            <div className="done-text">인증 완료!</div>
          </div>
        )}

        {/* 미리보기 / 촬영 화면 */}
        {status !== "done" && (
          <>
            <div className="cam-box">
              {/* 카메라 영상 */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`cam-video ${status === "streaming" ? "visible" : ""}`}
              />

              {/* 촬영된 사진 미리보기 */}
              {capturedImage && (
                <img src={capturedImage} alt="촬영된 사진" className="cam-preview" />
              )}

              {/* 대기 화면 */}
              {status === "idle" && (
                <div className="cam-placeholder">
                  <div className="cam-icon">📷</div>
                  <p>카메라 시작 버튼을 눌러주세요</p>
                </div>
              )}

              {/* 실시간 타임스탬프 */}
              {status === "streaming" && (
                <div className="ts-overlay">
                  <div className="ts-time">{tsDisplay.timeLine}</div>
                  <div className="ts-date">{tsDisplay.dateLine}</div>
                </div>
              )}

              {/* 사진 번호 (2장 인증, done/uploading 제외하고 표시) */}
              {certMethod === 2 && photoIndex && status !== "done" && status !== "uploading" && (
                <div className="ts-photo-index">{photoIndex} / {certMethod}</div>
              )}

              {/* 업로드 중 */}
              {status === "uploading" && (
                <div className="uploading-overlay">
                  <div className="upload-spinner" />
                  <p>업로드 중...</p>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: "none" }} />

            {error && <div className="error-msg">{error}</div>}

            {/* 버튼 영역 */}
            <div className="cam-controls">
              {status === "idle" && (
                <button className="btn-start" onClick={startCamera}>
                  카메라 시작
                </button>
              )}
              {status === "streaming" && (
                <>
                  <button className="btn-cancel" onClick={() => { stopCamera(); setStatus("idle"); }}>
                    취소
                  </button>
                  <button className="btn-capture" onClick={capturePhoto}>
                    촬영하기
                  </button>
                </>
              )}
              {status === "preview" && (
                <>
                  <button className="btn-cancel" onClick={retake}>
                    다시 찍기
                  </button>
                  <button className="btn-upload" onClick={uploadPhoto}>
                    인증 등록하기
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Camera;