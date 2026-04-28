import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const ENGINE_CONFIG = {
  TURN_TIMER_SEC: 30,
  VERSION: '2.0.0',
  CONSECUTIVE_LIMIT: 2,
  PRESSURE_OVERS: 2, // last N overs = pressure zone
};

// ─── RUN CARDS ────────────────────────────────────────────────────────────────
const RUN_CARDS = [
  { value: 0, label: 'Dot', sublabel: 'Safe', color: '#334155', icon: '🛡️' },
  { value: 1, label: '1 Run', sublabel: 'Safe', color: '#1e40af', icon: '🏃' },
  { value: 2, label: '2 Runs', sublabel: 'Balanced', color: '#065f46', icon: '⚡' },
  { value: 3, label: '3 Runs', sublabel: 'Risky', color: '#92400e', icon: '🎯' },
  { value: 4, label: 'FOUR', sublabel: 'Risky', color: '#7c2d12', icon: '🔥' },
  { value: 6, label: 'SIX', sublabel: 'Aggressive', color: '#581c87', icon: '💥' },
];

// ─── BOWLING STYLES ───────────────────────────────────────────────────────────
const BOWL_STYLES = [
  { value: 'defend', label: 'Defend', sublabel: 'Dot balls, low risk', color: '#1e3a5f', icon: '🧱' },
  { value: 'normal', label: 'Normal', sublabel: 'Balanced outcome', color: '#1e3a2f', icon: '⚖️' },
  { value: 'attack', label: 'Attack', sublabel: 'Wickets or runs', color: '#4a1942', icon: '⚔️' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function resolveName(uid, lobbyData) {
  if (!uid) return '—';
  const p = lobbyData?.players?.[uid];
  if (p) return p.name;
  if (uid.startsWith('bot_')) return 'Bot';
  return uid.slice(0, 8) + '…';
}

function isPressureOver(overNumber, totalOvers) {
  return overNumber >= totalOvers - ENGINE_CONFIG.PRESSURE_OVERS;
}

function randomBotBatting(runAttempt) {
  // Bots pick weighted random — lean toward 1s and 2s
  const weights = [0.15, 0.30, 0.25, 0.10, 0.12, 0.08];
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < weights.length; i++) {
    cum += weights[i];
    if (r < cum) return { runAttempt: RUN_CARDS[i].value };
  }
  return { runAttempt: 1 };
}

function randomBotBowling() {
  const styles = ['defend', 'normal', 'attack'];
  return { style: styles[Math.floor(Math.random() * styles.length)] };
}

// ─── ENGINE ───────────────────────────────────────────────────────────────────
function evaluateOutcome(bowlStyle, runAttempt, pressure) {
  // Returns { runs, isWicket, wicketType, commentary, resultType }
  // resultType: 'dot' | 'runs' | 'boundary' | 'six' | 'wicket'
  const r = Math.random();

  // Pressure multiplier — last overs raise stakes
  const pm = pressure ? 1.3 : 1.0;

  // Base wicket probabilities per bowling style
  const wicketBase = { defend: 0.06, normal: 0.12, attack: 0.22 };
  // Base boundary probabilities per run attempt
  const boundaryBase = { 0: 0.02, 1: 0.04, 2: 0.08, 3: 0.14, 4: 0.30, 6: 0.50 };

  const wicketChance = wicketBase[bowlStyle] * pm;
  const boundaryChance = boundaryBase[runAttempt] * pm;

  // Attack bowl vs aggressive bat = high drama
  const bothAggressive = bowlStyle === 'attack' && runAttempt >= 4;
  const bothDefensive = bowlStyle === 'defend' && runAttempt === 0;

  // Wicket check
  let wicketRoll = r;
  if (bothAggressive) wicketRoll *= 0.7; // more likely to go for runs
  if (runAttempt === 0 && bowlStyle === 'attack') wicketRoll *= 0.6; // defend vs attack = more wicket risk

  if (wicketRoll < wicketChance) {
    const types = ['bowled', 'caught', 'lbw', 'run out'];
    const typeWeights = bowlStyle === 'attack'
      ? [0.3, 0.4, 0.2, 0.1]
      : [0.25, 0.25, 0.35, 0.15];
    let tw = Math.random(), cum = 0;
    let wicketType = 'caught';
    for (let i = 0; i < types.length; i++) {
      cum += typeWeights[i];
      if (tw < cum) { wicketType = types[i]; break; }
    }
    const commentaries = {
      bowled: ['Timber! The stumps are shattered!', 'Clean bowled! What a delivery!', 'Beaten all ends up — bowled!'],
      caught: ['Skied it... and taken! CAUGHT!', 'Finds the fielder perfectly. OUT!', 'Straight down the throat — CAUGHT!'],
      lbw: ['Plumb in front! Finger goes up. LBW!', 'Trapped on the crease — LBW!', 'Big appeal... and given! LBW!'],
      'run out': ['Mix up in the middle! Direct hit — RUN OUT!', 'Sent back too late — RUN OUT!'],
    };
    const pool = commentaries[wicketType];
    return {
      runs: 0, isWicket: true, wicketType,
      commentary: pool[Math.floor(Math.random() * pool.length)],
      resultType: 'wicket'
    };
  }

  // Boundary / runs check
  if (r < boundaryChance) {
    if (runAttempt === 6) {
      const sixCommentary = [
        'Absolutely smashed! That\'s a SIX!', 'Into the stands! Massive SIX!',
        'Cleared the rope with ease! SIX!', 'That\'s gone all the way! SIX!'
      ];
      return { runs: 6, isWicket: false, wicketType: null, commentary: sixCommentary[Math.floor(Math.random() * sixCommentary.length)], resultType: 'six' };
    }
    if (runAttempt >= 4) {
      const fourCommentary = [
        'Cracked through the gap! FOUR!', 'Races away to the boundary! FOUR!',
        'Pierces the field perfectly! FOUR!', 'Timed to perfection — FOUR!'
      ];
      return { runs: 4, isWicket: false, wicketType: null, commentary: fourCommentary[Math.floor(Math.random() * fourCommentary.length)], resultType: 'boundary' };
    }
  }

  // Dot ball check
  if (bothDefensive || (bowlStyle === 'defend' && runAttempt <= 1 && r > 0.55)) {
    const dotCommentary = ['Dot ball. Pressure building.', 'Defended solidly. No run.', 'Tight line, nothing to hit.', 'Maiden territory — dot ball.'];
    return { runs: 0, isWicket: false, wicketType: null, commentary: dotCommentary[Math.floor(Math.random() * dotCommentary.length)], resultType: 'dot' };
  }

  // Normal runs — capped at runAttempt, may get less
  const actualRuns = Math.min(runAttempt, Math.max(0, runAttempt - Math.floor(Math.random() * 2)));
  const runCommentary = [
    `${actualRuns} run${actualRuns !== 1 ? 's' : ''} taken.`,
    `Pushed into the gap for ${actualRuns}.`,
    `Worked away for ${actualRuns}.`,
    `${actualRuns} off that delivery.`,
  ];
  return {
    runs: actualRuns, isWicket: false, wicketType: null,
    commentary: runCommentary[Math.floor(Math.random() * runCommentary.length)],
    resultType: actualRuns === 0 ? 'dot' : 'runs'
  };
}

// ─── CARD BUTTON ──────────────────────────────────────────────────────────────
function CardButton({ card, selected, onSelect, disabled }) {
  return (
    <button
      onClick={() => !disabled && onSelect(card.value)}
      disabled={disabled}
      style={{
        background: selected ? card.color : 'rgba(255,255,255,0.05)',
        border: selected ? `2px solid white` : '2px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '14px 8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        transition: 'all 0.15s ease',
        transform: selected ? 'scale(1.06)' : 'scale(1)',
        boxShadow: selected ? '0 0 20px rgba(255,255,255,0.2)' : 'none',
        minWidth: '70px',
        flex: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: '22px' }}>{card.icon}</span>
      <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{card.label}</span>
      <span style={{ fontSize: '10px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.sublabel}</span>
    </button>
  );
}

// ─── STYLE BUTTON ─────────────────────────────────────────────────────────────
function StyleButton({ style, selected, onSelect, disabled }) {
  return (
    <button
      onClick={() => !disabled && onSelect(style.value)}
      disabled={disabled}
      style={{
        background: selected ? style.color : 'rgba(255,255,255,0.05)',
        border: selected ? '2px solid white' : '2px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '18px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        transition: 'all 0.15s ease',
        transform: selected ? 'scale(1.06)' : 'scale(1)',
        boxShadow: selected ? '0 0 20px rgba(255,255,255,0.2)' : 'none',
        flex: 1,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: '28px' }}>{style.icon}</span>
      <span style={{ fontWeight: 'bold', fontSize: '16px' }}>{style.label}</span>
      <span style={{ fontSize: '11px', opacity: 0.7 }}>{style.sublabel}</span>
    </button>
  );
}

// ─── REVEAL ANIMATION ─────────────────────────────────────────────────────────
function RevealPanel({ result }) {
  if (!result) return null;
  const colors = { wicket: '#7f1d1d', six: '#4c1d95', boundary: '#78350f', dot: '#1e293b', runs: '#14532d' };
  const icons = { wicket: '💀', six: '💥', boundary: '🔥', dot: '🛡️', runs: '⚡' };
  return (
    <div style={{
      background: colors[result.resultType] || '#1e293b',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '16px',
      padding: '24px',
      textAlign: 'center',
      animation: 'fadeIn 0.3s ease',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '8px' }}>{icons[result.resultType]}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>
        {result.isWicket ? 'WICKET!' : result.runs === 6 ? 'SIX!' : result.runs === 4 ? 'FOUR!' : result.runs === 0 ? 'DOT' : `${result.runs} RUN${result.runs !== 1 ? 'S' : ''}`}
      </div>
      <div style={{ fontSize: '14px', opacity: 0.85, fontStyle: 'italic' }}>{result.commentary}</div>
    </div>
  );
}

// ─── MAIN MATCH COMPONENT ─────────────────────────────────────────────────────
export default function Match({ lobbyData, matchId, leaveLobby }) {
  const { currentUser } = useAuth();
  const [matchData, setMatchData] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ENGINE_CONFIG.TURN_TIMER_SEC);
  const [lastResult, setLastResult] = useState(null);
  const timerBallRef = useRef(null);
  const imHost = lobbyData.hostId === currentUser.uid;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'matches', matchId), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setMatchData(data);
        // Show result when both inputs arrive and processing starts
        if (data.lastResult) setLastResult(data.lastResult);
      }
    });
    return () => unsub();
  }, [matchId]);

  // Timer — only resets on new ball
  useEffect(() => {
    if (!matchData || matchData.status !== 'in-progress') return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) return;
    const ballKey = `${matchData.innings}-${matchData.overNumber}-${matchData.ballNumber}`;
    if (timerBallRef.current === ballKey) return;
    timerBallRef.current = ballKey;
    setTimeLeft(ENGINE_CONFIG.TURN_TIMER_SEC);
    setLastResult(null);
    setSelectedRun(null);
    setSelectedStyle(null);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(interval); if (imHost) forceTimeout(matchData); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [matchData?.innings, matchData?.overNumber, matchData?.ballNumber, matchData?.status]);

  function forceTimeout(m) {
    const updates = {};
    if (!m.ballInput?.bowler) updates['ballInput.bowler'] = randomBotBowling();
    if (!m.ballInput?.batsman) updates['ballInput.batsman'] = randomBotBatting();
    if (Object.keys(updates).length > 0) updateDoc(doc(db, 'matches', matchId), updates);
  }

  // Auto-bot actions
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress' || matchData.processingResult) return;
    const bIn = matchData.ballInput?.bowler;
    const batIn = matchData.ballInput?.batsman;
    const t = setTimeout(() => {
      if (!bIn && matchData.currentBowlerId?.startsWith('bot_'))
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': randomBotBowling() });
      if (!batIn && matchData.strikerId?.startsWith('bot_'))
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': randomBotBatting() });
    }, 800);
    return () => clearTimeout(t);
  }, [
    matchData?.status, matchData?.strikerId, matchData?.currentBowlerId,
    matchData?.ballNumber, matchData?.overNumber, matchData?.innings,
    matchData?.processingResult, !!matchData?.ballInput?.bowler, !!matchData?.ballInput?.batsman,
  ]);

  // Engine execution — host only
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress' || matchData.processingResult) return;
    const bIn = matchData.ballInput?.bowler;
    const batIn = matchData.ballInput?.batsman;
    if (bIn && batIn) processBall(matchData);
  }, [matchData]);

  // Deadlock recovery
  useEffect(() => {
    if (!matchData || !imHost || !matchData.processingResult) return;
    const t = setTimeout(() => {
      updateDoc(doc(db, 'matches', matchId), { processingResult: false, ballInput: { bowler: null, batsman: null } });
    }, 20000);
    return () => clearTimeout(t);
  }, [matchData?.processingResult]);

  // Over-break timeout
  useEffect(() => {
    if (!matchData || matchData.status !== 'over-break' || !imHost) return;
    const timer = setTimeout(() => {
      const roster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
      const eligible = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
      const pool = eligible.length > 0 ? eligible : roster;
      const pick = pool.find(p => !p.isBot) || pool[0];
      if (pick) updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: pick.uid });
    }, ENGINE_CONFIG.TURN_TIMER_SEC * 1000);
    return () => clearTimeout(timer);
  }, [matchData?.status, matchData?.overNumber]);

  // Toss bot auto-resolve
  useEffect(() => {
    if (!matchData || !imHost) return;
    if (matchData.status === 'toss' && !matchData.tossCall) {
      const callerCap = Object.values(lobbyData.players).find(p => p.team === matchData.tossCallerTeam && p.isCaptain);
      if (callerCap?.isBot) {
        const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
        const winnerTeam = coinResult === 'heads' ? matchData.tossCallerTeam : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
        const t = setTimeout(() => updateDoc(doc(db, 'matches', matchId), { tossCall: 'heads', tossCoinResult: coinResult, tossWinnerTeam: winnerTeam }), 800);
        return () => clearTimeout(t);
      }
    }
    if (matchData.status === 'toss' && matchData.tossWinnerTeam && !matchData.tossChoice) {
      const winnerCap = Object.values(lobbyData.players).find(p => p.team === matchData.tossWinnerTeam && p.isCaptain);
      if (winnerCap?.isBot) {
        const t = setTimeout(() => submitTossChoice('bat', matchData), 1000);
        return () => clearTimeout(t);
      }
    }
  }, [matchData?.status, matchData?.tossCall, matchData?.tossWinnerTeam, matchData?.tossChoice]);

  async function processBall(m) {
    await updateDoc(doc(db, 'matches', matchId), { processingResult: true });
    const bowlStyle = m.ballInput.bowler.style;
    const runAttempt = m.ballInput.batsman.runAttempt;
    const pressure = isPressureOver(m.overNumber, m.totalOvers);

    let { runs, isWicket, wicketType, commentary, resultType } = evaluateOutcome(bowlStyle, runAttempt, pressure);

    // Consecutive limits
    if (runs === 6 && (m.consecSixes || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) {
      runs = 4; commentary = 'One bounce over the rope — FOUR!'; resultType = 'boundary';
    }
    if (isWicket && (m.consecWickets || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) {
      isWicket = false; runs = 1; commentary = 'Edged but falls short! Single taken.'; resultType = 'runs'; wicketType = null;
    }

    const consecSixes = runs === 6 ? (m.consecSixes || 0) + 1 : 0;
    const consecWickets = isWicket ? (m.consecWickets || 0) + 1 : 0;
    const resultRecord = { bowlStyle, runAttempt, runs, isWicket, wicketType, commentary, resultType, pressure };

    let nextScore = m.score + runs;
    let nextWickets = m.wickets + (isWicket ? 1 : 0);
    let nextBall = m.ballNumber + 1;
    let nextOver = m.overNumber;
    let overComplete = false;
    let swappedStriker = m.strikerId;
    let swappedNonStriker = m.nonStrikerId;

    if (runs % 2 !== 0 && m.nonStrikerId) { swappedStriker = m.nonStrikerId; swappedNonStriker = m.strikerId; }
    if (nextBall === 6) {
      nextBall = 0; nextOver += 1; overComplete = true;
      if (m.nonStrikerId) { const tmp = swappedStriker; swappedStriker = swappedNonStriker; swappedNonStriker = tmp; }
    }

    const nextOutPlayers = [...(m.outPlayers || [])];
    if (isWicket) nextOutPlayers.push(m.strikerId);

    const maxWickets = m.lastManStand ? m.teamLists[m.battingTeam].length : Math.max(1, m.teamLists[m.battingTeam].length - 1);
    const endOfInnings = nextWickets >= maxWickets || nextOver >= m.totalOvers;
    const chaseSucceeded = m.innings === 2 && nextScore >= m.target;
    const chaseFailed = m.innings === 2 && endOfInnings && nextScore < m.target;
    const isTie = m.innings === 2 && endOfInnings && nextScore === m.target - 1 && !chaseSucceeded;
    const matchEnded = chaseSucceeded || chaseFailed || isTie;

    if (matchEnded) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: isTie ? 'completed-tie' : 'completed',
        score: nextScore, wickets: nextWickets,
        history: [...(m.history || []), resultRecord],
        lastResult: resultRecord,
        ballInput: { bowler: null, batsman: null }, processingResult: false
      }); return;
    }
    if (endOfInnings) {
      await updateDoc(doc(db, 'matches', matchId), {
        innings: 2, battingTeam: m.bowlingTeam, bowlingTeam: m.battingTeam,
        target: nextScore + 1, score: 0, wickets: 0, ballNumber: 0, overNumber: 0, outPlayers: [],
        strikerId: m.teamLists[m.bowlingTeam][0],
        nonStrikerId: m.teamLists[m.bowlingTeam].length > 1 ? m.teamLists[m.bowlingTeam][1] : null,
        currentBowlerId: m.teamLists[m.battingTeam][0],
        history: [...(m.history || []), resultRecord],
        lastResult: resultRecord,
        ballInput: { bowler: null, batsman: null },
        consecSixes: 0, consecWickets: 0, processingResult: false
      }); return;
    }

    let nextStriker = swappedStriker;
    if (isWicket) {
      const avail = m.teamLists[m.battingTeam].filter(id => !nextOutPlayers.includes(id) && id !== swappedNonStriker);
      nextStriker = avail.length > 0 ? avail[0] : null;
    }

    if (overComplete) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'over-break', score: nextScore, wickets: nextWickets, ballNumber: 0, overNumber: nextOver,
        strikerId: nextStriker, nonStrikerId: swappedNonStriker, outPlayers: nextOutPlayers,
        lastOverBowlerId: m.currentBowlerId,
        history: [...(m.history || []), resultRecord],
        lastResult: resultRecord,
        ballInput: { bowler: null, batsman: null },
        consecSixes, consecWickets, processingResult: false
      }); return;
    }

    await updateDoc(doc(db, 'matches', matchId), {
      score: nextScore, wickets: nextWickets, ballNumber: nextBall, overNumber: nextOver,
      strikerId: nextStriker, nonStrikerId: swappedNonStriker,
      currentBowlerId: m.currentBowlerId, lastOverBowlerId: m.lastOverBowlerId || null,
      outPlayers: nextOutPlayers,
      history: [...(m.history || []), resultRecord],
      lastResult: resultRecord,
      ballInput: { bowler: null, batsman: null },
      consecSixes, consecWickets, processingResult: false
    });
  }

  async function submitBowling() {
    if (!selectedStyle || loading) return;
    if (matchData.currentBowlerId !== currentUser.uid) return;
    if (matchData.ballInput?.bowler) return;
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': { style: selectedStyle, submittedBy: currentUser.uid } });
    setLoading(false);
  }

  async function submitBatting() {
    if (selectedRun === null || loading) return;
    if (matchData.strikerId !== currentUser.uid) return;
    if (matchData.ballInput?.batsman) return;
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': { runAttempt: selectedRun, submittedBy: currentUser.uid } });
    setLoading(false);
  }

  async function submitNextBowler(uid) {
    await updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: uid });
  }

  async function submitTossCall(call) {
    const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
    const winnerTeam = coinResult === call ? matchData.tossCallerTeam : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
    await updateDoc(doc(db, 'matches', matchId), { tossCall: call, tossCoinResult: coinResult, tossWinnerTeam: winnerTeam });
  }

  async function submitTossChoice(choice, m) {
    const md = m || matchData;
    const batFirst = choice === 'bat' ? md.tossWinnerTeam : (md.tossWinnerTeam === 'A' ? 'B' : 'A');
    const bowlFirst = batFirst === 'A' ? 'B' : 'A';
    const teamAIds = md.teamLists.A;
    const teamBIds = md.teamLists.B;
    await updateDoc(doc(db, 'matches', matchId), {
      status: 'in-progress', tossChoice: choice, innings: 1,
      battingTeam: batFirst, bowlingTeam: bowlFirst,
      score: 0, wickets: 0, target: null, ballNumber: 0, overNumber: 0,
      strikerId: batFirst === 'A' ? teamAIds[0] : teamBIds[0],
      nonStrikerId: batFirst === 'A' ? (teamAIds.length > 1 ? teamAIds[1] : null) : (teamBIds.length > 1 ? teamBIds[1] : null),
      currentBowlerId: bowlFirst === 'A' ? teamAIds[0] : teamBIds[0],
    });
  }

  if (!matchData) return <div className="container center" style={{ color: 'white' }}>Loading Match...</div>;

  const isMyTurnToBowl = matchData.currentBowlerId === currentUser.uid;
  const isMyTurnToBat = matchData.strikerId === currentUser.uid;
  const amBowlingCaptain = !!Object.values(lobbyData.players).find(p => p.uid === currentUser.uid && p.team === matchData.bowlingTeam && p.isCaptain);
  const strikerName = resolveName(matchData.strikerId, lobbyData);
  const nonStrikerName = resolveName(matchData.nonStrikerId, lobbyData);
  const bowlerName = resolveName(matchData.currentBowlerId, lobbyData);
  const pressure = matchData.overNumber !== undefined && isPressureOver(matchData.overNumber, matchData.totalOvers);
  const bothLocked = !!(matchData.ballInput?.bowler && matchData.ballInput?.batsman);

  // ── TOSS ─────────────────────────────────────────────────────────────────────
  if (matchData.status === 'toss') {
    const callerTeamName = matchData.tossCallerTeam === 'A' ? lobbyData.teamAName : lobbyData.teamBName;
    const iAmCaller = !!Object.values(lobbyData.players).find(p => p.uid === currentUser.uid && p.team === matchData.tossCallerTeam && p.isCaptain);
    const coinFlipped = !!matchData.tossCoinResult;
    const winnerTeamName = matchData.tossWinnerTeam === 'A' ? lobbyData.teamAName : lobbyData.teamBName;
    const iAmWinner = !!Object.values(lobbyData.players).find(p => p.uid === currentUser.uid && p.team === matchData.tossWinnerTeam && p.isCaptain);
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '24px', maxWidth: '480px' }}>
        <div style={{ background: 'var(--card-bg)', padding: '30px', borderRadius: '16px', width: '100%', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontSize: '72px', marginBottom: '12px' }}>🪙</div>
          <h2 style={{ margin: '0 0 20px' }}>The Toss</h2>
          {!coinFlipped ? (
            <>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                <strong style={{ color: 'white' }}>{callerTeamName}</strong> captain calls the toss
              </p>
              {iAmCaller ? (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => submitTossCall('heads')} className="button primary" style={{ flex: 1, fontSize: '18px' }}>🪙 Heads</button>
                  <button onClick={() => submitTossCall('tails')} className="button secondary" style={{ flex: 1, fontSize: '18px' }}>🔄 Tails</button>
                </div>
              ) : <p style={{ color: 'var(--text-secondary)' }}>Waiting for {callerTeamName} captain to call...</p>}
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {callerTeamName} called <strong style={{ color: 'white', textTransform: 'capitalize' }}>{matchData.tossCall}</strong>
              </p>
              <p style={{ fontSize: '22px', marginBottom: '12px' }}>
                Coin: <strong style={{ color: matchData.tossCoinResult === matchData.tossCall ? 'var(--success-color)' : 'var(--error-color)', textTransform: 'capitalize' }}>{matchData.tossCoinResult}</strong>
              </p>
              <div style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid gold', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
                <span style={{ color: 'gold', fontWeight: 'bold', fontSize: '18px' }}>{winnerTeamName} wins the toss!</span>
              </div>
              {iAmWinner ? (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => submitTossChoice('bat', matchData)} className="button primary" style={{ flex: 1 }}>🏏 Bat First</button>
                  <button onClick={() => submitTossChoice('bowl', matchData)} className="button secondary" style={{ flex: 1 }}>🎳 Bowl First</button>
                </div>
              ) : <p style={{ color: 'var(--text-secondary)' }}>Waiting for {winnerTeamName} captain to choose...</p>}
            </>
          )}
        </div>
        <button onClick={leaveLobby} className="button secondary" style={{ maxWidth: '160px' }}>Leave</button>
      </div>
    );
  }

  // ── MATCH SUMMARY ─────────────────────────────────────────────────────────────
  if (matchData.status === 'completed' || matchData.status === 'completed-tie') {
    const isTie = matchData.status === 'completed-tie';
    let resultLine = 'Match Tied!';
    if (!isTie) {
      const battingWon = matchData.innings === 2 && matchData.score >= matchData.target;
      const winningTeam = battingWon ? matchData.battingTeam : matchData.bowlingTeam;
      const winningTeamName = winningTeam === 'A' ? lobbyData.teamAName : lobbyData.teamBName;
      if (battingWon) {
        const wicketsLeft = matchData.teamLists[winningTeam].length - 1 - matchData.wickets;
        resultLine = `${winningTeamName} won by ${wicketsLeft} wicket${wicketsLeft !== 1 ? 's' : ''}!`;
      } else {
        const runMargin = matchData.target - 1 - matchData.score;
        resultLine = `${winningTeam === 'A' ? lobbyData.teamBName : lobbyData.teamAName} won by ${runMargin} run${runMargin !== 1 ? 's' : ''}!`;
      }
    }
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
        <div style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)', border: '1px solid rgba(255,215,0,0.3)', padding: '30px', borderRadius: '16px', width: '100%' }}>
          <div style={{ fontSize: '56px', marginBottom: '12px' }}>🏆</div>
          <h1 style={{ color: 'gold', marginBottom: '8px' }}>{resultLine}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Final: {matchData.score}/{matchData.wickets} | Overs: {matchData.overNumber}.{matchData.ballNumber}</p>
          {matchData.target && <p style={{ color: 'var(--text-secondary)' }}>Target was {matchData.target}</p>}
        </div>
        <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px', width: '100%', maxHeight: '280px', overflowY: 'auto', textAlign: 'left' }}>
          <h3 style={{ marginBottom: '12px' }}>Ball-by-Ball</h3>
          {(matchData.history || []).map((h, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '12px', minWidth: '50px' }}>Ball {i + 1}</span>
              <span style={{ color: h.isWicket ? '#ef4444' : h.runs >= 4 ? '#fbbf24' : 'white', fontSize: '13px' }}>{h.commentary}</span>
            </div>
          ))}
        </div>
        <button onClick={leaveLobby} className="button secondary">Leave Match</button>
      </div>
    );
  }

  // ── OVER BREAK ────────────────────────────────────────────────────────────────
  if (matchData.status === 'over-break') {
    const roster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
    const eligible = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
    const bowlerList = eligible.length > 0 ? eligible : roster;
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '480px' }}>
        <div style={{ background: 'var(--card-bg)', padding: '24px', borderRadius: '16px', width: '100%' }}>
          <h2 style={{ marginBottom: '6px' }}>Over Complete</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Score: {matchData.score}/{matchData.wickets}</p>
          <h3 style={{ marginBottom: '12px' }}>Select Next Bowler</h3>
          {amBowlingCaptain || imHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {bowlerList.map(p => (
                <button key={p.uid} onClick={() => submitNextBowler(p.uid)} className="button primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {p.isBot ? '🤖' : '👤'} {p.name} {p.isCaptain ? '[C]' : ''}
                </button>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-secondary)' }}>Waiting for bowling captain...</p>}
        </div>
      </div>
    );
  }

  // ── IN-PROGRESS ───────────────────────────────────────────────────────────────
  const timerColor = timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : 'white';
  const teamAName = lobbyData.teamAName;
  const teamBName = lobbyData.teamBName;
  const battingTeamName = matchData.battingTeam === 'A' ? teamAName : teamBName;
  const bowlingTeamName = matchData.bowlingTeam === 'A' ? teamAName : teamBName;

  return (
    <div className="container" style={{ color: 'white', flexDirection: 'column', gap: '16px', maxWidth: '860px', margin: '0 auto' }}>

      {/* Scoreboard */}
      <div style={{
        background: pressure ? 'linear-gradient(135deg, #1a0a0a, #2d0a0a)' : 'var(--card-bg)',
        border: pressure ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.08)',
        padding: '20px', borderRadius: '16px', textAlign: 'center', position: 'relative'
      }}>
        {pressure && <div style={{ position: 'absolute', top: '10px', left: '16px', color: '#ef4444', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>🔥 PRESSURE ZONE</div>}
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          Innings {matchData.innings} · Over {matchData.overNumber}.{matchData.ballNumber} / {matchData.totalOvers}
        </div>
        <div style={{ fontSize: '42px', fontWeight: 'bold', lineHeight: 1 }}>{matchData.score}<span style={{ fontSize: '24px', opacity: 0.6 }}>/{matchData.wickets}</span></div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{battingTeamName} batting</div>
        {matchData.target && (
          <div style={{ marginTop: '8px', padding: '6px 14px', background: 'rgba(251,191,36,0.15)', borderRadius: '20px', display: 'inline-block', color: '#fbbf24', fontSize: '14px' }}>
            Need {matchData.target - matchData.score} off {(matchData.totalOvers - matchData.overNumber) * 6 - matchData.ballNumber} balls
          </div>
        )}
        <div style={{ position: 'absolute', top: '12px', right: '16px', background: 'rgba(0,0,0,0.4)', padding: '8px 12px', borderRadius: '8px' }}>
          <span style={{ color: timerColor, fontWeight: 'bold', fontSize: '18px' }}>⏱ {timeLeft}s</span>
        </div>
      </div>

      {/* Players on field */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '12px 16px', borderRadius: '10px', fontSize: '13px' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>🏏 On Strike</div>
          <div style={{ fontWeight: 'bold' }}>{strikerName}</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '12px 16px', borderRadius: '10px', fontSize: '13px' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>🏃 Non-Striker</div>
          <div style={{ fontWeight: 'bold' }}>{nonStrikerName || '—'}</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '12px 16px', borderRadius: '10px', fontSize: '13px' }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>🎳 Bowler</div>
          <div style={{ fontWeight: 'bold' }}>{bowlerName}</div>
        </div>
      </div>

      {/* Last result reveal */}
      {lastResult && <RevealPanel result={lastResult} />}

      {/* Both locked — waiting for engine */}
      {bothLocked && !lastResult && (
        <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '12px', textAlign: 'center', color: '#fbbf24' }}>
          ⚡ Both decisions locked — revealing outcome...
        </div>
      )}

      {/* Action panels */}
      {!bothLocked && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>

          {/* Bowling panel */}
          <div style={{ flex: 1, minWidth: '280px', background: 'var(--card-bg)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0 }}>🎳 {bowlingTeamName}</h3>
              {matchData.ballInput?.bowler && <span style={{ color: 'var(--success-color)', fontSize: '13px' }}>✓ Locked</span>}
            </div>
            {matchData.ballInput?.bowler ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--success-color)' }}>
                <div style={{ fontSize: '32px' }}>🔒</div>
                <div>Delivery locked in — waiting for batsman</div>
              </div>
            ) : isMyTurnToBowl ? (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>Choose your bowling style:</p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  {BOWL_STYLES.map(s => (
                    <StyleButton key={s.value} style={s} selected={selectedStyle === s.value} onSelect={setSelectedStyle} disabled={loading} />
                  ))}
                </div>
                <button onClick={submitBowling} disabled={!selectedStyle || loading} className="button primary">
                  {loading ? 'Locking...' : 'Lock Delivery 🔒'}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
                Waiting for {bowlerName}...
              </div>
            )}
          </div>

          {/* Batting panel */}
          <div style={{ flex: 1, minWidth: '280px', background: 'var(--card-bg)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0 }}>🏏 {battingTeamName}</h3>
              {matchData.ballInput?.batsman && <span style={{ color: 'var(--success-color)', fontSize: '13px' }}>✓ Locked</span>}
            </div>
            {matchData.ballInput?.batsman ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--success-color)' }}>
                <div style={{ fontSize: '32px' }}>🔒</div>
                <div>Shot locked in — waiting for bowler</div>
              </div>
            ) : isMyTurnToBat ? (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '12px' }}>Choose your run attempt:</p>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {RUN_CARDS.map(c => (
                    <CardButton key={c.value} card={c} selected={selectedRun === c.value} onSelect={setSelectedRun} disabled={loading} />
                  ))}
                </div>
                <button onClick={submitBatting} disabled={selectedRun === null || loading} className="button primary">
                  {loading ? 'Locking...' : 'Lock Shot 🔒'}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
                Waiting for {strikerName}...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commentary history */}
      {matchData.history?.length > 0 && (
        <div style={{ background: 'var(--card-bg)', padding: '14px 16px', borderRadius: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>Recent Balls</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[...matchData.history].reverse().slice(0, 5).map((h, i) => (
              <div key={i} style={{ fontSize: '13px', display: 'flex', gap: '10px', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{
                  minWidth: '28px', textAlign: 'center', fontWeight: 'bold',
                  color: h.isWicket ? '#ef4444' : h.runs === 6 ? '#a78bfa' : h.runs === 4 ? '#fbbf24' : h.runs === 0 ? '#64748b' : '#10b981'
                }}>
                  {h.isWicket ? 'W' : h.runs}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>{h.commentary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <button onClick={leaveLobby} className="button secondary" style={{ maxWidth: '180px' }}>Leave Match</button>
      </div>
    </div>
  );
}
