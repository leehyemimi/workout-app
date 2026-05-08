import { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, getDocs, writeBatch, Timestamp } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { storage } from "../firebase";
import { auth, db } from "../firebase";
import Camera from "./Camera";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "./Main.css";

// offset(주 단위)을 적용한 주의 월~일 날짜 반환
function getWeekDates(offset = 0) {
  const today = new Date();
  today.setDate(today.getDate() + offset * 7);
  const day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

// Date → weekId ("2026-W19")
function toWeekId(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// 최근 N주의 weekId 목록 반환
function getPastWeekIds(n = 8) {
  return Array.from({ length: n }, (_, i) => {
    const dates = getWeekDates(-i);
    return toWeekId(dates[0]);
  });
}

// 기본 앱 시작일 (Firestore 로드 전 fallback)
const APP_START_DATE = new Date(2026, 3, 1); // 2026-04-01

function getWeeksFromStart(startDate = APP_START_DATE, endDate = null) {
  const weekIds = [];
  const seen = new Set();
  const cur = new Date(startDate);
  const limit = endDate && endDate < new Date() ? endDate : new Date();
  while (cur <= limit) {
    const wid = toWeekId(cur);
    if (!seen.has(wid)) { seen.add(wid); weekIds.push(wid); }
    cur.setDate(cur.getDate() + 7);
  }
  const limitWid = toWeekId(limit);
  if (!seen.has(limitWid)) weekIds.push(limitWid);
  return weekIds;
}

// weekId → "M/D ~ M/D" 레이블
function weekIdToLabel(weekId) {
  const [year, w] = weekId.split("-W");
  const jan1 = new Date(Number(year), 0, 1);
  const mon = new Date(jan1);
  mon.setDate(jan1.getDate() + (Number(w) - 1) * 7 - (jan1.getDay() === 0 ? 6 : jan1.getDay() - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.getMonth() + 1}/${mon.getDate()} ~ ${sun.getMonth() + 1}/${sun.getDate()}`;
}

// 해당 월에 포함된 주 ID 목록 반환
function getMonthWeekIds(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekIds = [];
  const seen = new Set();
  for (let d = 1; d <= daysInMonth; d++) {
    const wid = toWeekId(new Date(year, month, d));
    if (!seen.has(wid)) {
      seen.add(wid);
      weekIds.push(wid);
    }
  }
  return weekIds;
}

// 한국 공휴일 반환 { "YYYY-MM-DD": "이름" }
function getKoreanHolidays(year) {
  const h = {};
  const add = (m, d, name) => { h[`${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`] = name; };
  // 고정 공휴일
  add(1,1,"신정"); add(3,1,"삼일절"); add(5,5,"어린이날");
  add(6,6,"현충일"); add(8,15,"광복절"); add(10,3,"개천절");
  add(10,9,"한글날"); add(12,25,"성탄절");
  // 음력 공휴일 (2025~2027 하드코딩)
  const lunar = {
    2025: [
      [1,28,"설날 전날"],[1,29,"설날"],[1,30,"설날 다음날"],
      [5,5,"부처님오신날"],
      [10,5,"추석 전날"],[10,6,"추석"],[10,7,"추석 다음날"],
    ],
    2026: [
      [2,16,"설날 전날"],[2,17,"설날"],[2,18,"설날 다음날"],
      [5,24,"부처님오신날"],
      [9,24,"추석 전날"],[9,25,"추석"],[9,26,"추석 다음날"],
    ],
    2027: [
      [2,5,"설날 전날"],[2,6,"설날"],[2,7,"설날 다음날"],
      [5,13,"부처님오신날"],
      [9,14,"추석 전날"],[9,15,"추석"],[9,16,"추석 다음날"],
    ],
  };
  const substitute = {
    2025: [[3,3,"대체공휴일"],[5,6,"대체공휴일"],[10,8,"대체공휴일"]],
    2026: [[3,2,"대체공휴일"],[5,25,"대체공휴일"],[8,17,"대체공휴일"],[9,28,"대체공휴일"],[10,5,"대체공휴일"]],
    2027: [[2,8,"대체공휴일"],[8,16,"대체공휴일"],[10,4,"대체공휴일"],[10,11,"대체공휴일"]],
  };
  (lunar[year] || []).forEach(([m, d, name]) => add(m, d, name));
  (substitute[year] || []).forEach(([m, d, name]) => add(m, d, name));
  return h;
}

// 이번 달 달력 그리드 (월요일 시작)
function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  const remainder = cells.length % 7;
  if (remainder !== 0) {
    for (let i = 1; i <= 7 - remainder; i++) cells.push(new Date(year, month + 1, i));
  }
  return cells;
}

// 인증 목록에서 uid 기준 하루 minPerDay장 이상인 날만 카운트
function countUniqueDays(certs, uid, minPerDay = 1) {
  const dayMap = new Map();
  certs
    .filter((c) => c.uid === uid)
    .forEach((c) => {
      const day = c.createdAt?.toDate?.()?.toDateString();
      if (day) dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });
  let count = 0;
  dayMap.forEach((v) => { if (v >= minPerDay) count++; });
  return count;
}

// 해당 주가 완전히 끝났는지 (일요일이 오늘 이전인지)
function isWeekCompleted(weekId) {
  const [year, w] = weekId.split("-W");
  const jan1 = new Date(Number(year), 0, 1);
  const mon = new Date(jan1);
  mon.setDate(jan1.getDate() + (Number(w) - 1) * 7 - (jan1.getDay() === 0 ? 6 : jan1.getDay() - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return sun < new Date();
}

// 하루의 인증 목록을 멤버별로 그룹화 → { uid, color, name, full }[]
function getDayDots(certsOnDay, members, getMemberColor) {
  const map = new Map();
  certsOnDay.forEach((c) => {
    map.set(c.uid, (map.get(c.uid) || 0) + 1);
  });
  const result = [];
  map.forEach((count, uid) => {
    const m = members.find((mb) => mb.uid === uid);
    result.push({
      uid,
      color: getMemberColor(uid),
      name: m?.name || "",
      full: !m || m.certMethod !== 2 || count >= 2,
    });
  });
  return result;
}

// 특정 주의 목표 횟수 반환 (goalHistory 기반, 없으면 weeklyGoal fallback)
function getGoalForWeek(member, weekId) {
  const history = member.goalHistory;
  if (history && typeof history === "object") {
    const applicable = Object.entries(history)
      .filter(([wid]) => wid <= weekId)
      .sort(([a], [b]) => b.localeCompare(a));
    if (applicable.length > 0) return applicable[0][1];
  }
  return member.weeklyGoal || 2;
}

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const EMOJIS = ["💪", "🏃", "🚴", "🏋️"];
const MEMBER_COLORS = ["#fde68a","#bbf7d0","#bfdbfe","#fecaca","#e9d5ff","#fed7aa","#a7f3d0","#fce7f3"];

function Main({ user }) {
  const [page, setPage] = useState("main");
  const [members, setMembers] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [monthCertifications, setMonthCertifications] = useState([]);
  const [allWeeksCerts, setAllWeeksCerts] = useState([]);
  const [myGoal, setMyGoal] = useState(2);
  const [myName, setMyName] = useState("");
  const [myIcon, setMyIcon] = useState("🐶");
  const [myColor, setMyColor] = useState(MEMBER_COLORS[0]);
  const [editingIconColor, setEditingIconColor] = useState(false);
  const [iconInput, setIconInput] = useState("🐶");
  const [colorInput, setColorInput] = useState(MEMBER_COLORS[0]);
  const [fineDetailOpen, setFineDetailOpen] = useState(false);
  const [editingCert, setEditingCert] = useState(null);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [appStartDate, setAppStartDate] = useState(APP_START_DATE);
  const [appEndDate, setAppEndDate] = useState(null);
  const [startDateInput, setStartDateInput] = useState("2026-04-01");
  const [endDateInput, setEndDateInput] = useState("");
  const [adminUid, setAdminUid] = useState(null);
  const [appTitle, setAppTitle] = useState("운동 인증");
  const [titleInput, setTitleInput] = useState("운동 인증");
  const [inviteCode, setInviteCode] = useState("workout");
  const [inviteCodeInput, setInviteCodeInput] = useState("workout");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(2);
  const [myCertMethod, setMyCertMethod] = useState(1);
  const [editingCertMethod, setEditingCertMethod] = useState(false);
  const [certMethodInput, setCertMethodInput] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calView, setCalView] = useState("week");
  const [weekOffset, setWeekOffset] = useState(0); // 0=이번 주, -1=지난 주, ...
  const [monthOffset, setMonthOffset] = useState(0); // 0=이번 달, -1=지난 달, ...
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [filterMember, setFilterMember] = useState(null); // null = 전체
  const [modalImg, setModalImg] = useState(null);
  const [openFineTooltip, setOpenFineTooltip] = useState(null);

  const now = new Date();
  const validFineWeeks = new Set(getWeeksFromStart(appStartDate, appEndDate).filter(isWeekCompleted));
  const startWid = toWeekId(appStartDate);
  const endWid = appEndDate ? toWeekId(appEndDate) : null;
  const weekDates = getWeekDates(weekOffset);
  const weekId = toWeekId(weekDates[0]); // 해당 주 월요일 기준 weekId
  const todayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const isCurrentWeek = weekOffset === 0;
  const isCurrentMonth = monthOffset === 0;
  const viewMonthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewYear = viewMonthDate.getFullYear();
  const viewMonth = viewMonthDate.getMonth();
  const monthGrid = getMonthGrid(viewYear, viewMonth);

  // 날짜가 인증 기간 밖인지 여부
  const isOutOfPeriod = (date) => {
    const d = new Date(date); d.setHours(0,0,0,0);
    const s = new Date(appStartDate); s.setHours(0,0,0,0);
    if (d < s) return true;
    if (appEndDate) { const e = new Date(appEndDate); e.setHours(0,0,0,0); if (d > e) return true; }
    return false;
  };

  // 인증 기간 기반 네비게이션 범위
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const todayMonday = getWeekDates(0)[0];
  const startMonday = new Date(appStartDate);
  startMonday.setDate(startMonday.getDate() - (startMonday.getDay() === 0 ? 6 : startMonday.getDay() - 1));
  const minWeekOffset = Math.round((startMonday - todayMonday) / msPerWeek);
  const maxWeekOffset = appEndDate
    ? (() => { const em = new Date(appEndDate); em.setDate(em.getDate() - (em.getDay() === 0 ? 6 : em.getDay() - 1)); return Math.round((em - todayMonday) / msPerWeek); })()
    : 0;
  const minMonthOffset = (appStartDate.getFullYear() - now.getFullYear()) * 12 + (appStartDate.getMonth() - now.getMonth());
  const maxMonthOffset = appEndDate
    ? (appEndDate.getFullYear() - now.getFullYear()) * 12 + (appEndDate.getMonth() - now.getMonth())
    : 0;

  // 주 레이블 (이번 주 / M/D ~ M/D)
  const weekDateRange = `${weekDates[0].getMonth() + 1}/${weekDates[0].getDate()} ~ ${weekDates[6].getMonth() + 1}/${weekDates[6].getDate()}`;
  const weekLabel = weekDateRange;

  // 첫 로그인 시 Firestore에 유저 등록
  useEffect(() => {
    const initUser = async () => {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        const savedName = localStorage.getItem(`workout-name-${user.uid}`) || "멤버";
        await setDoc(userRef, {
          uid: user.uid,
          name: savedName,
          weeklyGoal: 2,
          createdAt: new Date(),
        });
        setMyName(savedName);
      } else {
        setMyGoal(snap.data().weeklyGoal || 2);
        setMyName(snap.data().name || "");
        const savedIcon = snap.data().icon || "🐶";
        setMyIcon(savedIcon);
        setIconInput(savedIcon);
        const savedColor = snap.data().color || MEMBER_COLORS[0];
        setMyColor(savedColor);
        setColorInput(savedColor);
        setMyCertMethod(snap.data().certMethod || 1);
      }
    };
    initUser();
  }, [user]);

  // 전체 설정 구독 (인증 기간, 방장 등)
  useEffect(() => {
    const settingsRef = doc(db, "settings", "global");
    const unsub = onSnapshot(settingsRef, async (snap) => {
      if (!snap.exists()) {
        // 최초 접속자가 방장
        await setDoc(settingsRef, { adminUid: user.uid, startDate: APP_START_DATE });
        setAdminUid(user.uid);
      } else {
        const data = snap.data();
        setAdminUid(data.adminUid || null);
        if (data.title) {
          setAppTitle(data.title);
          setTitleInput(data.title);
        }
        if (data.inviteCode) {
          setInviteCode(data.inviteCode);
          setInviteCodeInput(data.inviteCode);
        }
        if (data.startDate) {
          const d = data.startDate.toDate();
          setAppStartDate(d);
          setStartDateInput(d.toISOString().slice(0, 10));
        }
        if (data.endDate) {
          const d = data.endDate.toDate();
          setAppEndDate(d);
          setEndDateInput(d.toISOString().slice(0, 10));
        } else {
          setAppEndDate(null);
          setEndDateInput("");
        }
      }
    });
    return () => unsub();
  }, [user.uid]);

  // 인증 기간 변경 시 offset 범위 보정
  useEffect(() => {
    const ms = 7 * 24 * 60 * 60 * 1000;
    const tMon = getWeekDates(0)[0];
    const sMon = new Date(appStartDate);
    sMon.setDate(sMon.getDate() - (sMon.getDay() === 0 ? 6 : sMon.getDay() - 1));
    const minW = Math.round((sMon - tMon) / ms);
    const maxW = appEndDate
      ? (() => { const em = new Date(appEndDate); em.setDate(em.getDate() - (em.getDay() === 0 ? 6 : em.getDay() - 1)); return Math.round((em - tMon) / ms); })()
      : 0;
    const minM = (appStartDate.getFullYear() - now.getFullYear()) * 12 + (appStartDate.getMonth() - now.getMonth());
    const maxM = appEndDate
      ? (appEndDate.getFullYear() - now.getFullYear()) * 12 + (appEndDate.getMonth() - now.getMonth())
      : 0;
    setWeekOffset(v => Math.min(maxW, Math.max(minW, v)));
    setMonthOffset(v => Math.min(maxM, Math.max(minM, v)));
  }, [appStartDate, appEndDate]);

  // 전체 유저 목록 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setMembers(snap.docs.map((d, i) => ({
        ...d.data(),
        emoji: d.data().icon || EMOJIS[i % EMOJIS.length],
        color: d.data().color || MEMBER_COLORS[i % MEMBER_COLORS.length],
        goalHistory: d.data().goalHistory || {},
        certMethod: d.data().certMethod || 1,
      })));
    });
    return () => unsub();
  }, []);

  // 선택된 주 인증 실시간 구독
  useEffect(() => {
    const q = query(collection(db, "certifications"), where("week", "==", weekId));
    const unsub = onSnapshot(q, (snap) => {
      setCertifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [weekId]);

  // 인증 기간 전체 구독 (벌금 현황용)
  useEffect(() => {
    let q = query(collection(db, "certifications"), where("createdAt", ">=", appStartDate));
    if (appEndDate) q = query(collection(db, "certifications"), where("createdAt", ">=", appStartDate), where("createdAt", "<=", appEndDate));
    const unsub = onSnapshot(q, (snap) => {
      setAllWeeksCerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [appStartDate, appEndDate]);

  // 선택된 달 인증 실시간 구독 (월 보기용)
  useEffect(() => {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 23, 59, 59);
    const q = query(
      collection(db, "certifications"),
      where("createdAt", ">=", startOfMonth),
      where("createdAt", "<=", endOfMonth)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMonthCertifications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [monthOffset]);

  const handleLogout = async () => {
    if (window.confirm("로그아웃 하시겠어요?")) await signOut(auth);
  };

  const handleSettingsOpen = () => {
    setNameInput(myName);
    setEditingName(false);
    setEditingIconColor(false);
    setEditingGoal(false);
    setGoalInput(myGoal);
    setEditingCertMethod(false);
    setCertMethodInput(myCertMethod);
    setSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    setEditingName(false);
    setEditingIconColor(false);
    setEditingGoal(false);
    setEditingCertMethod(false);
  };

  const handleNameSave = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setEditingName(false);
    await updateDoc(doc(db, "users", user.uid), { name: trimmed });
    // 기존 인증 기록 userName 일괄 동기화
    const snap = await getDocs(query(collection(db, "certifications"), where("uid", "==", user.uid)));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.update(d.ref, { userName: trimmed }));
      await batch.commit();
    }
  };

  const handleIconColorSave = async () => {
    setMyIcon(iconInput);
    setMyColor(colorInput);
    setEditingIconColor(false);
    await updateDoc(doc(db, "users", user.uid), { icon: iconInput, color: colorInput });
  };

  const getMemberColor = (uid) => {
    const m = members.find(mb => mb.uid === uid);
    return m?.color || MEMBER_COLORS[members.findIndex(mb => mb.uid === uid) % MEMBER_COLORS.length] || MEMBER_COLORS[0];
  };

  const handleGoalSave = async () => {
    const currentWeekId = toWeekId(getWeekDates(0)[0]);
    const me = members.find(m => m.uid === user.uid);
    const hasBaseline = Object.keys(me?.goalHistory || {}).some(wid => wid < currentWeekId);
    const updates = {
      weeklyGoal: goalInput,
      [`goalHistory.${currentWeekId}`]: goalInput,
    };
    // 현재 주 이전 기록이 없으면 기존 목표를 베이스라인으로 저장
    if (!hasBaseline) {
      updates["goalHistory.0000-W00"] = myGoal;
    }
    setMyGoal(goalInput);
    setEditingGoal(false);
    await updateDoc(doc(db, "users", user.uid), updates);
  };

  const handleSeedData = async () => {
    const sampleMembers = [
      { uid: "sample-1", name: "김도연", weeklyGoal: 3, goalHistory: { "0000-W00": 3 }, certMethod: 1 },
      { uid: "sample-2", name: "오은혜", weeklyGoal: 2, goalHistory: { "0000-W00": 2 }, certMethod: 2 },
      { uid: "sample-3", name: "이병권", weeklyGoal: 3, goalHistory: { "0000-W00": 3 }, certMethod: 1 },
    ];
    for (const m of sampleMembers) {
      await setDoc(doc(db, "users", m.uid), {
        uid: m.uid,
        name: m.name,
        email: `${m.uid}@sample.com`,
        photoURL: null,
        weeklyGoal: m.weeklyGoal,
        goalHistory: m.goalHistory,
        certMethod: m.certMethod,
        createdAt: new Date(),
      });
    }
    const certData = [
      { uid: "sample-1", userName: "김도연", daysAgo: 1 },
      { uid: "sample-1", userName: "김도연", daysAgo: 3 },
      { uid: "sample-2", userName: "오은혜", daysAgo: 0 },
      { uid: "sample-2", userName: "오은혜", daysAgo: 2 },
      { uid: "sample-3", userName: "이병권", daysAgo: 1 },
    ];
    for (const c of certData) {
      const d = new Date();
      d.setDate(d.getDate() - c.daysAgo);
      d.setHours(10, 0, 0, 0);
      await addDoc(collection(db, "certifications"), {
        uid: c.uid,
        userName: c.userName,
        userPhoto: null,
        imageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80",
        week: toWeekId(d),
        createdAt: Timestamp.fromDate(d),
      });
    }
    // 4/27 ~ 5/3 주간 인증 데이터
    const weekCertData = [
      // 김도연 (certMethod=1, goal=3): 3회
      { uid: "sample-1", userName: "김도연", date: new Date(2026, 3, 27) },
      { uid: "sample-1", userName: "김도연", date: new Date(2026, 3, 29) },
      { uid: "sample-1", userName: "김도연", date: new Date(2026, 4, 1) },
      // 오은혜 (certMethod=2, goal=2): 2회 × 2장
      { uid: "sample-2", userName: "오은혜", date: new Date(2026, 3, 28) },
      { uid: "sample-2", userName: "오은혜", date: new Date(2026, 3, 28) },
      { uid: "sample-2", userName: "오은혜", date: new Date(2026, 3, 30) },
      { uid: "sample-2", userName: "오은혜", date: new Date(2026, 3, 30) },
      // 이병권 (certMethod=1, goal=3): 3회
      { uid: "sample-3", userName: "이병권", date: new Date(2026, 3, 28) },
      { uid: "sample-3", userName: "이병권", date: new Date(2026, 3, 30) },
      { uid: "sample-3", userName: "이병권", date: new Date(2026, 4, 2) },
    ];
    for (const c of weekCertData) {
      const d = new Date(c.date);
      d.setHours(10, 0, 0, 0);
      await addDoc(collection(db, "certifications"), {
        uid: c.uid,
        userName: c.userName,
        userPhoto: null,
        imageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80",
        week: toWeekId(d),
        createdAt: Timestamp.fromDate(d),
      });
    }
  };

  const handleDeleteCert = async (cert) => {
    if (!window.confirm("이 인증 기록을 삭제할까요?")) return;
    await deleteDoc(doc(db, "certifications", cert.id));
    if (cert.storagePath) {
      try {
        await deleteObject(ref(storage, cert.storagePath));
      } catch (_) {}
    }
    if (modalImg === cert.imageUrl) setModalImg(null);
  };

  const handleDayClick = (date) => {
    if (!date) return;
    setSelectedDate(prev => prev?.toDateString() === date.toDateString() ? null : date);
  };

  const handleWeekChange = (delta) => {
    setWeekOffset(prev => prev + delta);
    setSelectedDate(null);
  };

  if (page === "camera") {
    const todayCount = certifications.filter((c) => {
      const d = c.createdAt?.toDate?.();
      return c.uid === user.uid && d && d.toDateString() === now.toDateString();
    }).length;
    return <Camera user={user} userName={myName} editingCert={editingCert} certMethod={myCertMethod} photoIndex={editingCert ? null : (todayCount % myCertMethod) + 1} onBack={() => { setEditingCert(null); setPage("main"); }} onSuccess={() => { setEditingCert(null); setPage("main"); }} />;
  }

  const activeCerts = calView === "week" ? certifications : monthCertifications;
  const selectedDayCerts = selectedDate
    ? activeCerts.filter((c) => {
        const d = c.createdAt?.toDate?.();
        return d && d.toDateString() === selectedDate.toDateString() && (!filterMember || c.uid === filterMember);
      })
    : [];

  const formatSelectedTitle = (date) => {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    return `${date.getMonth() + 1}/${date.getDate()} (${dayNames[date.getDay()]}) 인증`;
  };

  return (
    <div className="main-wrap" onClick={() => setOpenFineTooltip(null)}>
      <header className="main-header">
        <div className="header-left">
          <span className="header-icon">🏋️</span>
          <span className="header-title">{appTitle}</span>
        </div>
        <div className="header-right">
          {adminUid === user.uid && (
            <button className="global-settings-btn" onClick={() => setGlobalSettingsOpen(true)}>전체설정</button>
          )}
          <button className="settings-btn profile-icon-btn" onClick={handleSettingsOpen}>
            <span className="profile-icon-circle" style={{ background: myColor }}>
              {myIcon}
            </span>
          </button>
          <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
        </div>
      </header>

      <div className="main-content">
        {/* 인증하기 버튼 (이번 주만) */}
        {isCurrentWeek && (() => {
          const todayCertCount = certifications.filter((c) => {
            const d = c.createdAt?.toDate?.();
            return c.uid === user.uid && d && d.toDateString() === now.toDateString();
          }).length;
          const todayDone = todayCertCount >= myCertMethod;
          return (
            <button
              className="cert-btn"
              onClick={() => !todayDone && setPage("camera")}
              disabled={todayDone}
              style={todayDone ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            >
              {todayDone
                ? "✓ 오늘 인증 완료"
                : myCertMethod === 2
                  ? `📸 오늘 운동 인증하기 (${todayCertCount}/2장)`
                  : "📸 오늘 운동 인증하기"}
            </button>
          );
        })()}


        {/* 누적 벌금 */}
        {members.length > 0 && (() => {
          const weekIds = [...validFineWeeks];
          const targetMembers = filterMember ? members.filter(m => m.uid === filterMember) : members;
          let total = 0;
          weekIds.forEach((wid) => {
            const wc = allWeeksCerts.filter((c) => c.week === wid);
            targetMembers.forEach((m) => {
              if (countUniqueDays(wc, m.uid, m.certMethod) < getGoalForWeek(m, wid)) total += 10000;
            });
          });
          return (
            <div className="fine-cumulative-wrap">
              <div className="fine-cumulative" onClick={() => setFineDetailOpen(v => !v)}>
                <span>누적 총 벌금{filterMember && ` · ${targetMembers[0]?.name}`}</span>
                <span className="fine-total-amount">{total.toLocaleString()}원 {fineDetailOpen ? "▲" : "▼"}</span>
              </div>
              <div className={`fine-cumulative-tooltip ${fineDetailOpen ? "open" : ""}`}>
                <table className="achieve-table">
                  <thead>
                    <tr>
                      <th className="achieve-th achieve-member-th" style={{ background: "#222", color: "#aaa" }}></th>
                      {weekIds.map((wid) => (
                        <th key={wid} className="achieve-th" style={{ background: "#222", color: "#aaa", borderBottom: "1px solid #444" }}>
                          {weekIdToLabel(wid)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {targetMembers.map((m) => {
                      return (
                        <tr key={m.uid}>
                          <td className="achieve-td achieve-member-td" style={{ background: "#333", borderBottom: "1px solid #444" }}>
                            <span className="member-name-icon" style={{ background: getMemberColor(m.uid) }}>{m.emoji}</span>
                            <span className="achieve-member-name" style={{ color: "#ddd" }}>{m.name}</span>
                          </td>
                          {weekIds.map((wid) => {
                            const done = countUniqueDays(allWeeksCerts.filter((c) => c.week === wid), m.uid, m.certMethod);
                            const success = done >= getGoalForWeek(m, wid);
                            return (
                              <td key={wid} className={`achieve-td achieve-cell ${success ? "achieve-success" : "achieve-fail"}`} style={{ borderBottom: "1px solid #444" }}>
                                {success ? "✓" : "✗"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* 달력 섹션 */}
        <section className="week-section">
          <div className="cal-section-top">
            {members.length > 0 && (
              <select
                className="cal-member-select"
                value={filterMember ?? ""}
                onChange={(e) => setFilterMember(e.target.value || null)}
              >
                <option value="">전체 멤버</option>
                {members.map((m) => (
                  <option key={m.uid} value={m.uid}>{m.emoji} {m.name}</option>
                ))}
              </select>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {calView === "week"
                ? (!isCurrentWeek && <button className="week-today-btn" onClick={() => { setWeekOffset(Math.min(0, maxWeekOffset)); setSelectedDate(null); }}>오늘</button>)
                : (!isCurrentMonth && <button className="week-today-btn" onClick={() => { setMonthOffset(Math.min(0, maxMonthOffset)); setSelectedDate(null); }}>오늘</button>)
              }
              <div className="cal-toggle">
                <button
                  className={`cal-toggle-btn ${calView === "week" ? "active" : ""}`}
                  onClick={() => { setCalView("week"); setSelectedDate(null); }}
                >주</button>
                <button
                  className={`cal-toggle-btn ${calView === "month" ? "active" : ""}`}
                  onClick={() => { setCalView("month"); setSelectedDate(null); }}
                >월</button>
              </div>
            </div>
          </div>

          {/* 주 보기 */}
          {calView === "week" && (
            <>
              <div className="week-bar-scroll">
              <div className="week-bar">
                <div className="cal-date-nav">
                  <button className="week-nav-btn" onClick={() => handleWeekChange(-1)} disabled={weekOffset <= minWeekOffset}>‹</button>
                  <span className="cal-date-label">
                    <span style={{ marginRight: 4 }}>📅</span>
                    {isCurrentWeek
                      ? <><span style={{ color: "#3b82f6", fontWeight: 700 }}>이번 주</span><span style={{ color: "#aaa", fontWeight: 400 }}> · {weekDateRange}</span></>
                      : weekDateRange}
                  </span>
                  <button className="week-nav-btn" onClick={() => handleWeekChange(1)} disabled={weekOffset >= maxWeekOffset}>›</button>
                </div>
                {weekDates.map((date, i) => {
                  const certsOnDay = certifications.filter((c) => {
                    const d = c.createdAt?.toDate?.();
                    return d && d.toDateString() === date.toDateString() && (!filterMember || c.uid === filterMember);
                  });
                  const isToday = date.toDateString() === now.toDateString();
                  const isSelected = selectedDate?.toDateString() === date.toDateString();
                  const outOfPeriod = isOutOfPeriod(date);
                  return (
                    <div
                      key={i}
                      className={`week-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${outOfPeriod ? "out-of-period" : ""}`}
                      onClick={() => handleDayClick(date)}
                    >
                      <span className={`day-name${i === 6 ? " sunday" : ""}`}>{DAYS[i]}</span>
                      {(() => {
                        const hk = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
                        const hn = getKoreanHolidays(date.getFullYear())[hk];
                        return <>
                          <span className={`day-num${hn || i === 6 ? " holiday-date" : ""}`}>{date.getDate()}</span>
                        </>;
                      })()}
                      <div className="day-dots">
                        {getDayDots(certsOnDay, members, getMemberColor).map((dot, di) => (
                          <span key={di} className={`month-dot${dot.full ? "" : " month-dot-half"}`} title={dot.name} style={{ background: dot.color }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {/* 벌금 칸 */}
                {members.length > 0 && (() => {
                  const targetMembers = filterMember ? members.filter(m => m.uid === filterMember) : members;
                  const weekCompleted = validFineWeeks.has(weekId);
                  const failMembers = weekCompleted ? targetMembers.filter((m) =>
                    countUniqueDays(certifications, m.uid, m.certMethod) < getGoalForWeek(m, weekId)
                  ) : [];
                  const fine = failMembers.length * 10000;
                  return (
                    <div className="week-day week-fine-cell">
                      <span className="day-name">벌금</span>
                      <div className="fine-tooltip-wrap" onClick={(e) => { e.stopPropagation(); setOpenFineTooltip(v => v === "week" ? null : "week"); }}>
                        <span className={`fine-cell-amount ${fine > 0 ? "has-fine" : "no-fine"}`}>
                          {fine > 0 ? `${fine / 10000}만` : weekCompleted ? "✓" : (weekId >= startWid && (!endWid || weekId <= endWid)) ? "⏳" : ""}
                        </span>
                        {fine > 0 && (
                          <div className={`fine-tooltip ${openFineTooltip === "week" ? "open" : ""}`}>
                            {failMembers.map((m, i) => (
                              <span key={i}>{m.emoji} {m.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>
            </>
          )}

          {/* 월 보기 */}
          {calView === "month" && (
            <div className="month-cal">
              <div className="cal-date-nav" style={{ marginBottom: 8 }}>
                <button className="week-nav-btn" onClick={() => { setMonthOffset(v => v - 1); setSelectedDate(null); }} disabled={monthOffset <= minMonthOffset}>‹</button>
                <span className="cal-date-label">
                  <span style={{ marginRight: 4 }}>📅</span>
                  {`${viewYear}년 ${viewMonth + 1}월`}
                </span>
                <button className="week-nav-btn" onClick={() => { setMonthOffset(v => v + 1); setSelectedDate(null); }} disabled={monthOffset >= maxMonthOffset}>›</button>
              </div>
              <div className="month-header">
                {DAYS.map((d, i) => <span key={d} className={`month-day-name${i === 6 ? " sunday" : ""}`}>{d}</span>)}
                <span className="month-day-name month-fine-header">벌금</span>
              </div>
              <div className="month-grid-scroll">
              <div className="month-grid">
                {(() => {
                  const rows = Math.ceil(monthGrid.length / 7);
                  const cells = [];
                  for (let row = 0; row < rows; row++) {
                    const rowDates = monthGrid.slice(row * 7, row * 7 + 7);
                    const firstDate = rowDates.find((d) => d !== null);
                    const wid = firstDate ? toWeekId(firstDate) : null;
                    if (!firstDate) continue;
                    const rowMon = rowDates[0] || (() => {
                      const d = new Date(firstDate);
                      const dow = d.getDay();
                      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
                      return d;
                    })();
                    const rowSun = new Date(rowMon);
                    rowSun.setDate(rowMon.getDate() + 6);
                    if (rowMon.getFullYear() !== viewYear || rowMon.getMonth() !== viewMonth) continue;
                    if (rowSun < appStartDate || (appEndDate && rowMon > appEndDate)) continue;
                    // 날짜 셀들
                    rowDates.forEach((date, col) => {
                      const idx = row * 7 + col;
                      if (!date) {
                        cells.push(<div key={`cell-${idx}`} className="month-cell empty" />);
                        return;
                      }
                      const certsOnDay = monthCertifications.filter((c) => {
                        const d = c.createdAt?.toDate?.();
                        return d && d.toDateString() === date.toDateString() && (!filterMember || c.uid === filterMember);
                      });
                      const isToday = date.toDateString() === now.toDateString();
                      const isSelected = selectedDate?.toDateString() === date.toDateString();
                      const outOfPeriod = isOutOfPeriod(date);
                      const holidayKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
                      const holidayName = getKoreanHolidays(date.getFullYear())[holidayKey];
                      const isSunday = col === 6;
                      cells.push(
                        <div
                          key={`cell-${idx}`}
                          className={`month-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${outOfPeriod ? "out-of-period" : ""}`}
                          onClick={() => handleDayClick(date)}
                        >
                          <span className={`month-date${holidayName || isSunday ? " holiday-date" : ""}`}>{date.getDate()}</span>
                          {holidayName && <span className="holiday-name">{holidayName}</span>}
                          <div className="day-dots">
                            {getDayDots(certsOnDay, members, getMemberColor).map((dot, di) => (
                              <span key={di} className={`month-dot${dot.full ? "" : " month-dot-half"}`} title={dot.name} style={{ background: dot.color }} />
                            ))}
                          </div>
                        </div>
                      );
                    });
                    // 벌금 셀 (행 뒤에)
                    if (wid && members.length > 0 && validFineWeeks.has(wid)) {
                      const wc = allWeeksCerts.filter((c) => c.week === wid);
                      const targetMembers = filterMember ? members.filter(m => m.uid === filterMember) : members;
                      const failMembers = targetMembers.filter(
                        (m) => countUniqueDays(wc, m.uid, m.certMethod) < getGoalForWeek(m, wid)
                      );
                      const fine = failMembers.length * 10000;
                      cells.push(
                        <div key={`fine-${row}`} className="month-cell month-fine-cell">
                          <div className="fine-tooltip-wrap" onClick={(e) => { e.stopPropagation(); setOpenFineTooltip(v => v === `month-${row}` ? null : `month-${row}`); }}>
                            <span className={`fine-cell-amount ${fine > 0 ? "has-fine" : "no-fine"}`}>
                              {fine > 0 ? `${fine / 10000}만` : "✓"}
                            </span>
                            {fine > 0 && (
                              <div className={`fine-tooltip ${openFineTooltip === `month-${row}` ? "open" : ""}`}>
                                {failMembers.map((m, mi) => (
                                  <span key={mi}>{m.emoji} {m.name}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } else {
                      cells.push(
                        <div key={`fine-empty-${row}`} className="month-cell month-fine-cell">
                          <span className="fine-cell-amount no-fine">⏳</span>
                        </div>
                      );
                    }
                  }
                  return cells;
                })()}
              </div>
              </div>
            </div>
          )}

          {/* 선택된 날짜 인증 기록 */}
          {selectedDate && (
            <div className="day-certs">
              <div className="day-certs-title">{formatSelectedTitle(selectedDate)}</div>
              {selectedDayCerts.length === 0 ? (
                <div className="day-certs-empty">이날 인증 기록이 없어요</div>
              ) : (
                <div className="day-certs-list">
                  {selectedDayCerts.map((c, i) => {
                    const member = members.find(m => m.uid === c.uid);
                    const photoIdx = member?.certMethod === 2
                      ? selectedDayCerts.slice(0, i).filter(x => x.uid === c.uid).length + 1
                      : null;
                    return (
                    <div key={i} className="day-cert-item">
                      <div className="day-cert-thumb-wrap" onClick={() => setModalImg(c.imageUrl)}>
                        <img src={c.imageUrl} alt={member?.name || ""} className="day-cert-thumb" />
                        {c.uid === user.uid && (
                          <>
                            <button className="cert-edit-btn" onClick={(e) => { e.stopPropagation(); setEditingCert(c); setPage("camera"); }}>✏️</button>
                            <button className="cert-delete-btn" onClick={(e) => { e.stopPropagation(); handleDeleteCert(c); }}>✕</button>
                          </>
                        )}
                        {photoIdx && <span className="thumb-photo-index">{photoIdx} / 2</span>}
                      </div>
                      <div className="day-cert-name">
                        <span className="member-name-icon" style={{ background: getMemberColor(c.uid) }}>{member?.emoji || "💪"}</span>
                        <span>{member?.name || ""}</span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 멤버별 현황 */}
        <section className="members-section">
          <div className="section-label">
            멤버 현황
          </div>
          <div className="member-list">
            {members.length === 0 && <div className="empty-msg">아직 등록된 멤버가 없어요</div>}
            {members.map((m) => {
              const done = countUniqueDays(certifications, m.uid, m.certMethod);
              const goal = getGoalForWeek(m, weekId);
              const percent = Math.min(Math.round((done / goal) * 100), 100);
              const success = done >= goal;
              const isMe = m.uid === user.uid;
              return (
                <div key={m.uid} className={`member-card ${isMe ? "my-card" : ""}`}>
                  <div className="member-top">
                    <div className="member-info">
                      <div className="member-name"><span className="member-name-icon" style={{ background: getMemberColor(m.uid) }}>{m.emoji}</span>{m.name} {isMe && <span className="me-badge">나</span>}</div>
                    </div>
                    <div className={`member-goal-status ${success ? "goal-success" : "goal-pending"}`}>
                      {success ? `✓ 주 ${goal}회 완료` : `${done} / ${goal}회 목표`}
                      {m.certMethod === 2 && <span className="cert-method-badge">📸 2장</span>}
                    </div>
                  </div>
                  <div className="progress-bar-wrap">
                    <div className={`progress-bar ${success ? "bar-success" : "bar-progress"}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </div>

      {/* 전체설정 레이어 */}
      {globalSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setGlobalSettingsOpen(false)}>
          <div className="settings-popup" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <span className="settings-title">전체설정</span>
              <button className="modal-close-inline" onClick={() => setGlobalSettingsOpen(false)}>✕</button>
            </div>
            <div className="settings-body">
              <div className="settings-row">
                <span className="settings-label">방장</span>
                <span className="settings-value">
                  {(() => { const admin = members.find(m => m.uid === adminUid); return admin ? `${admin.emoji} ${admin.name}` : "-"; })()}
                </span>
              </div>
              <div className="goal-divider" />
              <div className="settings-row">
                <span className="settings-label">타이틀</span>
                <input
                  className="date-input"
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="운동 인증"
                  maxLength={20}
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">입장 코드</span>
                <input
                  className="date-input"
                  type="text"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  placeholder="workout"
                  maxLength={20}
                />
              </div>
              <div className="goal-divider" />
              <div className="settings-row">
                <span className="settings-label">인증 시작일</span>
                <DatePicker
                  className="date-input"
                  selected={startDateInput ? new Date(startDateInput) : null}
                  onChange={(date) => setStartDateInput(date ? date.toISOString().slice(0, 10) : "")}
                  dateFormat="yyyy-MM-dd"
                  calendarStartDay={1}
                  placeholderText="시작일 선택"
                />
              </div>
              <div className="settings-row">
                <span className="settings-label">인증 종료일</span>
                <DatePicker
                  className="date-input"
                  selected={endDateInput ? new Date(endDateInput) : null}
                  onChange={(date) => setEndDateInput(date ? date.toISOString().slice(0, 10) : "")}
                  dateFormat="yyyy-MM-dd"
                  calendarStartDay={1}
                  placeholderText="종료일 선택"
                  isClearable
                />
              </div>
              <div className="global-settings-desc">종료일을 비우면 현재까지로 계산됩니다</div>
              <div className="settings-row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  className="name-save-btn"
                  onClick={async () => {
                    if (!startDateInput) return;
                    const newStart = new Date(startDateInput);
                    const newEnd = endDateInput ? new Date(endDateInput) : null;
                    const data = { startDate: newStart, adminUid, title: titleInput || "운동 인증", inviteCode: inviteCodeInput || "workout" };
                    if (newEnd) data.endDate = newEnd; else data.endDate = null;
                    await setDoc(doc(db, "settings", "global"), data, { merge: true });
                    setGlobalSettingsOpen(false);
                  }}
                >저장</button>
              </div>
              <div className="goal-divider" />
              <div className="settings-row" style={{ justifyContent: "flex-end" }}>
                <button
                  className="danger-btn"
                  onClick={async () => {
                    if (!window.confirm("인증 기록을 전체 삭제할까요?")) return;
                    if (!window.confirm("정말로 삭제하면 복구할 수 없어요. 계속할까요?")) return;
                    const snap = await getDocs(collection(db, "certifications"));
                    const batch = writeBatch(db);
                    snap.docs.forEach((d) => batch.delete(d.ref));
                    await batch.commit();
                    setGlobalSettingsOpen(false);
                  }}
                >인증 기록 전체 삭제</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 설정 팝업 */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={handleSettingsClose}>
          <div className="settings-popup" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <span className="settings-title">설정</span>
              <button className="modal-close-inline" onClick={handleSettingsClose}>✕</button>
            </div>
            <div className="settings-body">
              {/* 아이콘 + 색상 */}
              {(() => {
                const takenColors = members.filter(m => m.uid !== user.uid).map(m => m.color).filter(Boolean);
                return (
                  <div className="settings-row" style={{ alignItems: "flex-start" }}>
                    <span className="settings-label" style={{ paddingTop: 4 }}>아이콘</span>
                    {editingIconColor ? (
                      <div className="icon-edit-wrap">
                        <div className="icon-preview-row">
                          <span className="profile-icon-circle icon-preview-large" style={{ background: colorInput }}>{iconInput}</span>
                        </div>
                        <div className="icon-grid">
                          {["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐸","🐧","🐺","🦝"].map((ic) => (
                            <button
                              key={ic}
                              className={`icon-btn ${iconInput === ic ? "icon-btn-active" : ""}`}
                              onClick={() => setIconInput(ic)}
                            >{ic}</button>
                          ))}
                        </div>
                        <div className="icon-color-label">배경 색상</div>
                        <div className="color-swatch-grid">
                          {MEMBER_COLORS.map((c) => {
                            const taken = takenColors.includes(c);
                            return (
                              <button
                                key={c}
                                className={`color-swatch ${colorInput === c ? "color-swatch-active" : ""} ${taken ? "color-swatch-taken" : ""}`}
                                style={{ background: c }}
                                onClick={() => !taken && setColorInput(c)}
                                disabled={taken}
                                title={taken ? "이미 사용 중인 색상" : ""}
                              />
                            );
                          })}
                        </div>
                        <div className="icon-edit-actions">
                          <button className="name-save-btn" onClick={handleIconColorSave}>저장</button>
                          <button className="name-cancel-btn" onClick={() => { setIconInput(myIcon); setColorInput(myColor); setEditingIconColor(false); }}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="name-display">
                        <span className="profile-icon-circle" style={{ background: myColor, fontSize: 18, width: 32, height: 32 }}>{myIcon}</span>
                        <button className="name-edit-btn" onClick={() => { setIconInput(myIcon); setColorInput(myColor); setEditingIconColor(true); }}>수정</button>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="goal-divider" />
              <div className="settings-row">
                <span className="settings-label">내 이름</span>
                {editingName ? (
                  <div className="name-edit-wrap">
                    <input
                      className="name-input"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleNameSave()}
                      autoFocus
                      maxLength={20}
                    />
                    <button className="name-save-btn" onClick={handleNameSave}>저장</button>
                    <button className="name-cancel-btn" onClick={() => setEditingName(false)}>취소</button>
                  </div>
                ) : (
                  <div className="name-display">
                    <span className="name-value">{myName}</span>
                    <button className="name-edit-btn" onClick={() => setEditingName(true)}>수정</button>
                  </div>
                )}
              </div>
              <div className="goal-divider" />
              <div className="settings-row">
                <span className="settings-label">주간 목표 횟수</span>
                {editingGoal ? (
                  <div className="name-edit-wrap">
                    <button className="goal-btn" onClick={() => setGoalInput(v => Math.max(1, v - 1))} disabled={goalInput <= 1}>−</button>
                    <span className="goal-value">주 {goalInput}회</span>
                    <button className="goal-btn" onClick={() => setGoalInput(v => Math.min(7, v + 1))} disabled={goalInput >= 7}>+</button>
                    <button className="name-save-btn" onClick={handleGoalSave}>저장</button>
                    <button className="name-cancel-btn" onClick={() => { setGoalInput(myGoal); setEditingGoal(false); }}>취소</button>
                  </div>
                ) : (
                  <div className="name-display">
                    <span className="name-value">주 {myGoal}회</span>
                    <button className="name-edit-btn" onClick={() => { setGoalInput(myGoal); setEditingGoal(true); }}>수정</button>
                  </div>
                )}
              </div>
              <div className="goal-divider" />
              <div className="settings-row">
                <span className="settings-label">일일 인증 방법</span>
                {editingCertMethod ? (
                  <div className="name-edit-wrap">
                    {[1, 2].map((n) => (
                      <button
                        key={n}
                        className={`cert-method-btn ${certMethodInput === n ? "active" : ""}`}
                        onClick={() => setCertMethodInput(n)}
                      >{n}장</button>
                    ))}
                    <button className="name-save-btn" onClick={async () => {
                      setMyCertMethod(certMethodInput);
                      setEditingCertMethod(false);
                      await updateDoc(doc(db, "users", user.uid), { certMethod: certMethodInput });
                    }}>저장</button>
                    <button className="name-cancel-btn" onClick={() => { setCertMethodInput(myCertMethod); setEditingCertMethod(false); }}>취소</button>
                  </div>
                ) : (
                  <div className="name-display">
                    <span className="name-value">하루 {myCertMethod}장</span>
                    <button className="name-edit-btn" onClick={() => { setCertMethodInput(myCertMethod); setEditingCertMethod(true); }}>수정</button>
                  </div>
                )}
              </div>
            </div>
            <div className="settings-hint">변경하면 즉시 반영돼요</div>
            <div style={{ padding: "0 20px 16px" }}>
              <button className="seed-btn" onClick={handleSeedData}>샘플 데이터 추가 (김도연·오은혜·이병권)</button>
            </div>
          </div>
        </div>
      )}

      {/* 사진 크게 보기 모달 */}
      {modalImg && (
        <div className="modal-backdrop" onClick={() => setModalImg(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModalImg(null)}>✕</button>
            <img src={modalImg} alt="인증 사진" className="modal-img" />
          </div>
        </div>
      )}
    </div>
  );
}

export default Main;
