import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const ENGINE_CONFIG = {
  TURN_TIMER_SEC: 15,
  ACCURACY_POOR_THRESHOLD: 0.2,
  ACCURACY_PERFECT_THRESHOLD: 0.8,
  VERSION: '1.0.0',
  CONSECUTIVE_LIMIT: 2,
  TOTAL_FIELDERS: 9,
};

const ZONES = ['off', 'straight', 'leg', 'deep-off', 'deep-leg'];
const DEFAULT_FIELD = { off: 3, straight: 2, leg: 2, 'deep-off': 1, 'deep-leg': 1 };

// Maps shot direction + loft to the relevant field zone
function checkFielder(fieldSettings, shotDirection, loft) {
  const field = fieldSettings || DEFAULT_FIELD;
  const zone = loft === 'lofted'
    ? (shotDirection === 'leg' ? 'deep-leg' : 'deep-off')
    : shotDirection;
  return (field[zone] || 0) > 0;
}

// Resolve a player UID to a display name using lobbyData
function resolveName(uid, lobbyData) {
  if (!uid) return '—';
  const p = lobbyData?.players?.[uid];
  if (p) return p.name;
  if (uid.startsWith('bot_')) return 'Bot';
  return uid.slice(0, 8) + '…';
}

// FieldSetter — bowling captain sets field before each ball
// FIX: accepts a `key` prop from parent to force re-mount when field is externally reset
function FieldSetter({ current, onSave }) {
  const [field, setField] = useState({ ...DEFAULT_FIELD, ...(current || {}) });
  const total = Object.values(field).reduce((a, b) => a + b, 0);
  const remaining = ENGINE_CONFIG.TOTAL_FIELDERS - total;

  function adjust(zone, delta) {
    const next = { ...field, [zone]: Math.max(0, (field[zone] || 0) + delta) };
    if (Object.values(next).reduce((a, b) => a + b, 0) > ENGINE_CONFIG.TOTAL_FIELDERS) return;
    setField(next);
  }

  return (
    <div style={{ background: 'var(--card-bg)', padding: '15px', borderRadius: '8px' }}>
      <h3 style={{ margin: '0 0 10px' }}>
        Set Field
        <span style={{ fontSize: '13px', color: remaining === 0 ? 'var(--success-color)' : 'orange', marginLeft: '10px' }}>
          {remaining === 0 ? '✓ Ready' : `${remaining} left to place`}
        </span>
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
        {ZONES.map(zone => (
          <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '6px 10px', borderRadius: '6px' }}>
            <span style={{ flex: 1, fontSize: '13px', textTransform: 'capitalize' }}>{zone.replace('-', ' ')}</span>
            <button onClick={() => adjust(zone, -1)} style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>−</button>
            <span style={{ minWidth: '20px', textAlign: 'center' }}>{field[zone] || 0}</span>
            <button onClick={() => adjust(zone, 1)} style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>+</button>
          </div>
        ))}
      </div>
      <button onClick={() => onSave(field)} disabled={remaining !== 0} className="button primary" style={{ width: '100%' }}>
        {remaining === 0 ? 'Confirm Field' : `Place ${remaining} more fielder${remaining !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}

export default function Match({ lobbyData, matchId, leaveLobby }) {
  const { currentUser } = useAuth();
  const [matchData, setMatchData] = useState(null);

  const [deliveryType, setDeliveryType] = useState('fast');
  const [line, setLine] = useState('off');
  const [shotType, setShotType] = useState('drive');
  const [intent, setIntent] = useState('neutral');
  const [batsmanDirection, setBatsmanDirection] = useState('off');
  const [batsmanLoft, setBatsmanLoft] = useState('ground');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ENGINE_CONFIG.TURN_TIMER_SEC);

  // FIX: use ref to track current ball identity for timer — prevents timer reset on every snapshot
  const timerBallRef = useRef(null);

  const imHost = lobbyData.hostId === currentUser.uid;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'matches', matchId), snap => {
      if (snap.exists()) setMatchData(snap.data());
    });
    return () => unsub();
  }, [matchId]);

  // TIMER — only resets when the ball actually changes, not on every snapshot
  useEffect(() => {
    if (!matchData || matchData.status !== 'in-progress') return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) return;

    const ballKey = `${matchData.innings}-${matchData.overNumber}-${matchData.ballNumber}`;
    if (timerBallRef.current === ballKey) return; // same ball, don't reset
    timerBallRef.current = ballKey;

    setTimeLeft(ENGINE_CONFIG.TURN_TIMER_SEC);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          if (imHost) forceTimeoutActions(matchData);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [matchData?.innings, matchData?.overNumber, matchData?.ballNumber, matchData?.status]);

  function forceTimeoutActions(m) {
    const updates = {};
    if (!m.ballInput?.bowler) updates['ballInput.bowler'] = { deliveryType: 'fast', line: 'off' };
    if (!m.ballInput?.batsman) updates['ballInput.batsman'] = { shotType: 'drive', intent: 'defend', direction: 'straight', loft: 'ground' };
    if (Object.keys(updates).length > 0) updateDoc(doc(db, 'matches', matchId), updates);
  }

  // AUTO-BOT: fires on host when it's a bot's turn
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress') return;
    if (matchData.processingResult || !matchData.fieldSettings) return;
    const bIn = matchData.ballInput?.bowler;
    const batIn = matchData.ballInput?.batsman;
    const t = setTimeout(() => {
      if (!bIn && matchData.currentBowlerId?.startsWith('bot_')) {
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': { deliveryType: 'fast', line: 'off' } });
      }
      if (!batIn && matchData.strikerId?.startsWith('bot_')) {
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': { shotType: 'drive', intent: 'neutral', direction: 'off', loft: 'ground' } });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [
    matchData?.status, matchData?.strikerId, matchData?.currentBowlerId,
    matchData?.ballNumber, matchData?.overNumber, matchData?.innings,
    matchData?.processingResult,
    !!matchData?.ballInput?.bowler, !!matchData?.ballInput?.batsman,
    !!matchData?.fieldSettings,
  ]);

  // ENGINE EXECUTION — host only, guarded by processingResult lock
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress') return;
    if (matchData.processingResult) return;
    const bIn = matchData.ballInput?.bowler;
    const batIn = matchData.ballInput?.batsman;
    if (bIn && batIn) evaluateBall(matchData);
  }, [matchData]);

  // FIX: processingResult deadlock recovery — if stuck for >20s, host clears the flag
  useEffect(() => {
    if (!matchData || !imHost || !matchData.processingResult) return;
    const t = setTimeout(() => {
      updateDoc(doc(db, 'matches', matchId), {
        processingResult: false,
        ballInput: { bowler: null, batsman: null }
      });
    }, 20000);
    return () => clearTimeout(t);
  }, [matchData?.processingResult]);

  async function evaluateBall(m) {
    await updateDoc(doc(db, 'matches', matchId), { processingResult: true });

    const bowlerIn = m.ballInput.bowler;
    const batIn = m.ballInput.batsman;
    let runs = 0, isWicket = false, wicketType = null, commentary = '';

    const accRoll = Math.random();
    let accuracy = 'good';
    if (accRoll > ENGINE_CONFIG.ACCURACY_PERFECT_THRESHOLD) accuracy = 'perfect';
    else if (accRoll < ENGINE_CONFIG.ACCURACY_POOR_THRESHOLD) accuracy = 'poor';

    const lineMatch = bowlerIn.line === batIn.direction;
    let shotQuality = 'good';
    if (lineMatch && accuracy !== 'perfect') shotQuality = 'perfect';
    if (!lineMatch && accuracy === 'perfect') shotQuality = 'mistimed';
    if (accuracy === 'poor') shotQuality = 'perfect';

    const hasFielder = checkFielder(m.fieldSettings, batIn.direction, batIn.loft);

    if (batIn.intent === 'defend') {
      if (accuracy === 'perfect' && !lineMatch && bowlerIn.deliveryType === 'yorker') {
        isWicket = true; wicketType = 'bowled'; commentary = 'Absolute peach of a yorker! Clean bowled!';
      } else {
        runs = 0; commentary = 'Solidly defended, no run.';
      }
    } else if (shotQuality === 'mistimed' || (accuracy === 'perfect' && batIn.intent === 'attack')) {
      if (batIn.loft === 'lofted' && hasFielder) {
        isWicket = true; wicketType = 'caught'; commentary = 'Lofted high in the air... CAUGHT!';
      } else if (bowlerIn.deliveryType === 'fast' && !lineMatch && Math.random() > 0.5) {
        isWicket = true; wicketType = 'lbw'; commentary = 'Trapped right in front! Plumb LBW.';
      } else {
        runs = batIn.loft === 'lofted' ? 2 : 1; commentary = 'Mistimed shot. Just muscled it.';
      }
    } else if (shotQuality === 'perfect' && batIn.intent === 'attack') {
      if (batIn.loft === 'lofted') {
        runs = 6; commentary = `Cracked! Fantastic ${batIn.shotType} over ${batIn.direction}! SIX!`;
      } else {
        runs = 4; commentary = `Beautiful timing on the ${batIn.shotType}! FOUR!`;
      }
    } else {
      if (hasFielder) { runs = 1; commentary = `Played into ${batIn.direction}, straight to the fielder. 1 run.`; }
      else { runs = 2; commentary = 'Pushed into the gap for two runs.'; }
    }

    // Balance control
    if (runs === 6 && (m.consecSixes || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { runs = 4; commentary = 'One bounce over the rope for four.'; }
    if (isWicket && (m.consecWickets || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { isWicket = false; runs = 1; commentary = 'Edged... falls short of slip! Single taken.'; }

    const consecSixes = runs === 6 ? (m.consecSixes || 0) + 1 : 0;
    const consecWickets = isWicket ? (m.consecWickets || 0) + 1 : 0;

    const resultRecord = {
      bowler: bowlerIn, batsman: batIn, runs, isWicket, wicketType, commentary,
      debug: { lineMatch, accuracy, shotQuality, hasFielder, intent: batIn.intent }
    };

    let nextScore = m.score + runs;
    let nextWickets = m.wickets + (isWicket ? 1 : 0);
    let nextBall = m.ballNumber + 1;
    let nextOver = m.overNumber;
    let overComplete = false;
    let swappedStriker = m.strikerId;
    let swappedNonStriker = m.nonStrikerId;

    if (runs % 2 !== 0 && m.nonStrikerId) {
      swappedStriker = m.nonStrikerId;
      swappedNonStriker = m.strikerId;
    }
    if (nextBall === 6) {
      nextBall = 0; nextOver += 1; overComplete = true;
      if (m.nonStrikerId) {
        const tmp = swappedStriker; swappedStriker = swappedNonStriker; swappedNonStriker = tmp;
      }
    }

    const nextOutPlayers = [...(m.outPlayers || [])];
    if (isWicket) nextOutPlayers.push(m.strikerId);

    // FIX: evaluate endOfInnings before matchEnded so both can't conflict
    const endOfInnings =
      nextWickets >= Math.max(1, m.teamLists[m.battingTeam].length - 1) ||
      nextOver >= m.totalOvers;

    // FIX: tie is when innings 2 ends with scores level, not score math on target
    const chaseSucceeded = m.innings === 2 && nextScore >= m.target;
    const chaseFailed = m.innings === 2 && endOfInnings && nextScore < m.target;
    const isTie = m.innings === 2 && endOfInnings && nextScore === m.target - 1 && !chaseSucceeded;
    const matchEnded = chaseSucceeded || chaseFailed || isTie;

    if (matchEnded) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: isTie ? 'completed-tie' : 'completed',
        score: nextScore, wickets: nextWickets,
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        processingResult: false
      });
      return;
    }

    if (endOfInnings) {
      await updateDoc(doc(db, 'matches', matchId), {
        innings: 2,
        battingTeam: m.bowlingTeam, bowlingTeam: m.battingTeam,
        target: nextScore + 1,
        score: 0, wickets: 0, ballNumber: 0, overNumber: 0, outPlayers: [],
        strikerId: m.teamLists[m.bowlingTeam][0],
        nonStrikerId: m.teamLists[m.bowlingTeam].length > 1 ? m.teamLists[m.bowlingTeam][1] : null,
        currentBowlerId: m.teamLists[m.battingTeam][0],
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        fieldSettings: null, consecSixes: 0, consecWickets: 0,
        processingResult: false
      });
      return;
    }

    let nextStriker = swappedStriker;
    if (isWicket) {
      const avail = m.teamLists[m.battingTeam].filter(id => !nextOutPlayers.includes(id) && id !== swappedNonStriker);
      nextStriker = avail.length > 0 ? avail[0] : null;
    }

    if (overComplete) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'over-break',
        score: nextScore, wickets: nextWickets, ballNumber: 0, overNumber: nextOver,
        strikerId: nextStriker, nonStrikerId: swappedNonStriker,
        outPlayers: nextOutPlayers, lastOverBowlerId: m.currentBowlerId,
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        fieldSettings: null, consecSixes, consecWickets,
        processingResult: false
      });
      return;
    }

    await updateDoc(doc(db, 'matches', matchId), {
      score: nextScore, wickets: nextWickets, ballNumber: nextBall, overNumber: nextOver,
      strikerId: nextStriker, nonStrikerId: swappedNonStriker,
      currentBowlerId: m.currentBowlerId, lastOverBowlerId: m.lastOverBowlerId || null,
      outPlayers: nextOutPlayers,
      history: [...(m.history || []), resultRecord],
      ballInput: { bowler: null, batsman: null },
      consecSixes, consecWickets, processingResult: false
      // fieldSettings intentionally not reset — persists within an over
    });
  }

  async function submitBowlingAction(e) {
    if (e) e.preventDefault();
    if (matchData.currentBowlerId !== currentUser.uid) return alert('Anti-cheat: You are not the active bowler.');
    if (matchData.ballInput?.bowler) return; // already submitted
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), {
      'ballInput.bowler': { deliveryType, line, submittedBy: currentUser.uid }
    });
    setLoading(false);
  }

  async function submitBattingAction(e) {
    if (e) e.preventDefault();
    if (matchData.strikerId !== currentUser.uid) return alert('Anti-cheat: You are not the active striker.');
    if (matchData.ballInput?.batsman) return; // already submitted
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), {
      'ballInput.batsman': { shotType, intent, direction: batsmanDirection, loft: batsmanLoft, submittedBy: currentUser.uid }
    });
    setLoading(false);
  }

  async function submitNextBowler(uid) {
    await updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: uid });
  }

  async function saveFieldSettings(field) {
    await updateDoc(doc(db, 'matches', matchId), { fieldSettings: field });
  }

  async function submitTossCall(call) {
    // Called by Team A's captain — 'heads' or 'tails'
    const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
    const winnerTeam = coinResult === call ? matchData.tossCallerTeam : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
    await updateDoc(doc(db, 'matches', matchId), {
      tossCall: call,
      tossCoinResult: coinResult,
      tossWinnerTeam: winnerTeam,
    });
  }

  async function submitTossChoice(choice, currentMatchData) {
    // choice: 'bat' or 'bowl'. currentMatchData passed explicitly to avoid stale closure.
    const m = currentMatchData || matchData;
    const batFirst = choice === 'bat' ? m.tossWinnerTeam : (m.tossWinnerTeam === 'A' ? 'B' : 'A');
    const bowlFirst = batFirst === 'A' ? 'B' : 'A';
    const teamAIds = m.teamLists.A;
    const teamBIds = m.teamLists.B;
    await updateDoc(doc(db, 'matches', matchId), {
      status: 'in-progress',
      tossChoice: choice,
      innings: 1,
      battingTeam: batFirst, bowlingTeam: bowlFirst,
      score: 0, wickets: 0, target: null, ballNumber: 0, overNumber: 0,
      strikerId: batFirst === 'A' ? teamAIds[0] : teamBIds[0],
      nonStrikerId: batFirst === 'A' ? (teamAIds.length > 1 ? teamAIds[1] : null) : (teamBIds.length > 1 ? teamBIds[1] : null),
      currentBowlerId: bowlFirst === 'A' ? teamAIds[0] : teamBIds[0],
    });
  }

  // Auto-resolve toss for bots — uses matchData from snapshot to avoid stale closure
  useEffect(() => {
    if (!matchData || !imHost) return;

    // Phase 1: auto-call if Team A captain is a bot
    if (matchData.status === 'toss' && !matchData.tossCall) {
      const callerCap = Object.values(lobbyData.players).find(
        p => p.team === matchData.tossCallerTeam && p.isCaptain
      );
      if (callerCap?.isBot) {
        const coinResult = Math.random() > 0.5 ? 'heads' : 'tails';
        const winnerTeam = coinResult === 'heads'
          ? matchData.tossCallerTeam
          : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
        const t = setTimeout(() => {
          updateDoc(doc(db, 'matches', matchId), {
            tossCall: 'heads',
            tossCoinResult: coinResult,
            tossWinnerTeam: winnerTeam,
          });
        }, 800);
        return () => clearTimeout(t);
      }
    }

    // Phase 2: auto-choose bat/bowl if winner captain is a bot
    if (matchData.status === 'toss' && matchData.tossWinnerTeam && !matchData.tossChoice) {
      const winnerCap = Object.values(lobbyData.players).find(
        p => p.team === matchData.tossWinnerTeam && p.isCaptain
      );
      if (winnerCap?.isBot) {
        const t = setTimeout(() => submitTossChoice('bat', matchData), 1000);
        return () => clearTimeout(t);
      }
    }
  }, [matchData?.status, matchData?.tossCall, matchData?.tossWinnerTeam, matchData?.tossChoice]);

  // FIX: auto-set field for bot bowling captain OR when bowler is bot but captain is human
  // Also handles the bot_auto edge case by falling back to DEFAULT_FIELD
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress') return;
    if (matchData.fieldSettings) return;
    const bowlingCap = Object.values(lobbyData.players).find(p => p.team === matchData.bowlingTeam && p.isCaptain);
    // Auto-set if captain is a bot, or if there's no human captain (bot_auto scenario)
    if (!bowlingCap || bowlingCap.isBot) {
      updateDoc(doc(db, 'matches', matchId), { fieldSettings: { ...DEFAULT_FIELD } });
    }
  }, [matchData?.status, matchData?.ballNumber, matchData?.overNumber, matchData?.innings, matchData?.fieldSettings]);

  // OVER-BREAK TIMEOUT — prevents soft-lock if bowling captain is AFK
  useEffect(() => {
    if (!matchData || matchData.status !== 'over-break' || !imHost) return;
    const timer = setTimeout(() => {
      const roster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
      const eligible = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
      // Prefer human, fall back to bot, fall back to first eligible regardless
      const pick = eligible.find(p => !p.isBot) || eligible[0];
      if (pick) {
        updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: pick.uid });
      }
    }, ENGINE_CONFIG.TURN_TIMER_SEC * 1000);
    return () => clearTimeout(timer);
  }, [matchData?.status, matchData?.overNumber]);

  if (!matchData) return <div className="container center" style={{ color: 'white' }}>Loading Match...</div>;

  // Derived state — computed after null guard
  const isMyTurnToBowl = matchData.currentBowlerId === currentUser.uid;
  const isMyTurnToBat = matchData.strikerId === currentUser.uid;
  const amBowlingCaptain = !!Object.values(lobbyData.players).find(
    p => p.uid === currentUser.uid && p.team === matchData.bowlingTeam && p.isCaptain
  );
  const fieldIsSet = !!matchData.fieldSettings;
  const strikerName = resolveName(matchData.strikerId, lobbyData);
  const bowlerName = resolveName(matchData.currentBowlerId, lobbyData);

  // ── TOSS SCREEN ──────────────────────────────────────────────────────────────
  if (matchData.status === 'toss') {
    const callerTeamName = matchData.tossCallerTeam === 'A' ? lobbyData.teamAName : lobbyData.teamBName;
    const iAmCaller = !!Object.values(lobbyData.players).find(
      p => p.uid === currentUser.uid && p.team === matchData.tossCallerTeam && p.isCaptain
    );
    const coinFlipped = !!matchData.tossCoinResult;
    const winnerTeamName = matchData.tossWinnerTeam === 'A' ? lobbyData.teamAName : lobbyData.teamBName;
    const iAmWinner = !!Object.values(lobbyData.players).find(
      p => p.uid === currentUser.uid && p.team === matchData.tossWinnerTeam && p.isCaptain
    );

    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '24px', maxWidth: '480px' }}>
        <div style={{ background: 'var(--card-bg)', padding: '30px', borderRadius: '12px', width: '100%' }}>
          <div style={{ fontSize: '64px', marginBottom: '10px' }}>🪙</div>
          <h2 style={{ margin: '0 0 20px' }}>The Toss</h2>

          {/* Phase 1 — caller picks heads or tails */}
          {!coinFlipped && (
            <>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                <strong style={{ color: 'white' }}>{callerTeamName}</strong> captain calls the toss
              </p>
              {iAmCaller ? (
                <>
                  <p style={{ marginBottom: '14px' }}>Call it:</p>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => submitTossCall('heads')} className="button primary" style={{ flex: 1, fontSize: '20px' }}>🪙 Heads</button>
                    <button onClick={() => submitTossCall('tails')} className="button secondary" style={{ flex: 1, fontSize: '20px' }}>🔄 Tails</button>
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Waiting for <strong style={{ color: 'white' }}>{callerTeamName}</strong> captain to call...
                </p>
              )}
            </>
          )}

          {/* Phase 2 — coin flipped, show result, winner chooses */}
          {coinFlipped && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  {callerTeamName} called <strong style={{ color: 'white', textTransform: 'capitalize' }}>{matchData.tossCall}</strong>
                </p>
                <p style={{ fontSize: '22px', marginBottom: '6px' }}>
                  Coin landed on{' '}
                  <strong style={{ color: matchData.tossCoinResult === matchData.tossCall ? 'var(--success-color)' : 'var(--error-color)', textTransform: 'capitalize' }}>
                    {matchData.tossCoinResult}
                  </strong>
                </p>
                <div style={{ background: 'rgba(255,255,255,0.06)', padding: '12px', borderRadius: '8px', marginTop: '10px' }}>
                  <span style={{ color: 'gold', fontWeight: 'bold', fontSize: '18px' }}>{winnerTeamName}</span>
                  <span> wins the toss!</span>
                </div>
              </div>

              {iAmWinner ? (
                <>
                  <p style={{ marginBottom: '14px' }}>Choose to bat or bowl first:</p>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={() => submitTossChoice('bat', matchData)} className="button primary" style={{ flex: 1 }}>🏏 Bat First</button>
                    <button onClick={() => submitTossChoice('bowl', matchData)} className="button secondary" style={{ flex: 1 }}>🎳 Bowl First</button>
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Waiting for <strong style={{ color: 'white' }}>{winnerTeamName}</strong> captain to choose...
                </p>
              )}
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
    // FIX: determine and display the winner explicitly
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
        resultLine = `${winningTeamName} won by ${runMargin} run${runMargin !== 1 ? 's' : ''}!`;
      }
    }
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
        <h1 style={{ color: 'gold' }}>{resultLine}</h1>
        <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', width: '100%' }}>
          <h2>Target: {matchData.target}</h2>
          <h1 style={{ color: 'var(--primary-color)' }}>Final Score: {matchData.score} / {matchData.wickets}</h1>
          <p>Overs: {matchData.overNumber}.{matchData.ballNumber}</p>
        </div>
        <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', width: '100%', maxHeight: '300px', overflowY: 'auto', textAlign: 'left' }}>
          <h3>Ball-by-Ball</h3>
          {(matchData.history || []).map((h, i) => (
            <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ color: 'var(--primary-color)' }}>[Ball {i + 1}]</span> {h.commentary}
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
    const eligibleBowlers = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px' }}>
        <h2>Over Complete!</h2>
        <p>Score: {matchData.score} / {matchData.wickets}</p>
        <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px' }}>
          <h3>Select Next Bowler</h3>
          {amBowlingCaptain || imHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {eligibleBowlers.map(p => (
                <button key={p.uid} onClick={() => submitNextBowler(p.uid)} className="button primary">{p.name}</button>
              ))}
              {eligibleBowlers.length === 0 && (
                <p style={{ color: 'orange' }}>No eligible bowlers — auto-selecting...</p>
              )}
            </div>
          ) : (
            <p>Waiting for bowling captain to select the next bowler...</p>
          )}
        </div>
      </div>
    );
  }

  // ── IN-PROGRESS MATCH UI ──────────────────────────────────────────────────────
  return (
    <div className="container" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '900px', margin: '0 auto' }}>

      {/* Scoreboard */}
      <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', textAlign: 'center', position: 'relative' }}>
        <h2>Innings {matchData.innings} | Over {matchData.overNumber}.{matchData.ballNumber} / {matchData.totalOvers}</h2>
        <h1 style={{ color: 'var(--primary-color)' }}>{matchData.score} / {matchData.wickets}</h1>
        {matchData.target && <p style={{ color: 'orange' }}>Target: {matchData.target} | Need {matchData.target - matchData.score} more</p>}
        {matchData.processingResult && <p style={{ color: 'yellow', fontSize: '13px' }}>Evaluating ball...</p>}
        <div style={{ position: 'absolute', top: '10px', right: '20px', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '8px' }}>
          <h3 style={{ margin: 0, color: timeLeft < 5 ? 'var(--error-color)' : 'white' }}>⏱ {timeLeft}s</h3>
        </div>
      </div>

      {/* Field Placement */}
      {/* FIX: key={fieldResetKey} forces FieldSetter to re-mount when field is externally reset */}
      {!fieldIsSet && (amBowlingCaptain || imHost) && (
        <FieldSetter key="field-setter" current={null} onSave={saveFieldSettings} />
      )}
      {!fieldIsSet && !amBowlingCaptain && !imHost && (
        <div style={{ background: 'var(--card-bg)', padding: '15px', borderRadius: '8px', textAlign: 'center', color: 'orange' }}>
          Waiting for bowling captain to set the field...
        </div>
      )}
      {fieldIsSet && (
        <div style={{ background: 'var(--card-bg)', padding: '10px 15px', borderRadius: '8px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--success-color)', fontWeight: 'bold' }}>Field:</span>
          {ZONES.map(z => (
            <span key={z} style={{ fontSize: '13px', background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: '4px' }}>
              {z.replace('-', ' ')}: <strong>{matchData.fieldSettings[z] || 0}</strong>
            </span>
          ))}
          {(amBowlingCaptain || imHost) && (
            <button
              onClick={() => updateDoc(doc(db, 'matches', matchId), { fieldSettings: null })}
              style={{ marginLeft: 'auto', fontSize: '12px', padding: '3px 10px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
            >
              Reset Field
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Bowler Panel */}
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '15px', borderRadius: '8px' }}>
          <h3>Bowling</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
            Bowler: <strong style={{ color: 'white' }}>{bowlerName}</strong>
          </p>
          {matchData.ballInput?.bowler ? (
            <p style={{ color: 'var(--success-color)' }}>✓ Delivery Locked In</p>
          ) : !fieldIsSet ? (
            <p style={{ color: 'orange', fontSize: '13px' }}>Set field first</p>
          ) : isMyTurnToBowl ? (
            <form onSubmit={submitBowlingAction} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <select value={deliveryType} onChange={e => setDeliveryType(e.target.value)} className="input">
                <option value="fast">Fast</option>
                <option value="spin">Spin</option>
                <option value="yorker">Yorker</option>
                <option value="bouncer">Bouncer</option>
              </select>
              <select value={line} onChange={e => setLine(e.target.value)} className="input">
                <option value="off">Off</option>
                <option value="middle">Middle</option>
                <option value="leg">Leg</option>
              </select>
              <button disabled={loading} type="submit" className="button primary">
                {loading ? 'Submitting...' : 'Submit Delivery'}
              </button>
            </form>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Waiting for bowler...</p>
          )}
        </div>

        {/* Batsman Panel */}
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '15px', borderRadius: '8px' }}>
          <h3>Batting</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
            On Strike: <strong style={{ color: 'white' }}>{strikerName}</strong>
          </p>
          {matchData.ballInput?.batsman ? (
            <p style={{ color: 'var(--success-color)' }}>✓ Shot Locked In</p>
          ) : !fieldIsSet ? (
            <p style={{ color: 'orange', fontSize: '13px' }}>Waiting for field to be set...</p>
          ) : isMyTurnToBat ? (
            <form onSubmit={submitBattingAction} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <select value={shotType} onChange={e => setShotType(e.target.value)} className="input">
                <option value="drive">Drive</option>
                <option value="pull">Pull</option>
                <option value="cut">Cut</option>
              </select>
              <select value={intent} onChange={e => setIntent(e.target.value)} className="input">
                <option value="attack">Attack</option>
                <option value="neutral">Neutral</option>
                <option value="defend">Defend</option>
              </select>
              <select value={batsmanDirection} onChange={e => setBatsmanDirection(e.target.value)} className="input">
                <option value="off">Off Side</option>
                <option value="straight">Straight</option>
                <option value="leg">Leg Side</option>
              </select>
              <select value={batsmanLoft} onChange={e => setBatsmanLoft(e.target.value)} className="input">
                <option value="ground">Along the Ground</option>
                <option value="lofted">Lofted</option>
              </select>
              <button disabled={loading} type="submit" className="button primary">
                {loading ? 'Submitting...' : 'Submit Shot'}
              </button>
            </form>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Waiting for batsman...</p>
          )}
        </div>
      </div>

      {/* Commentary */}
      <div style={{ background: 'var(--card-bg)', padding: '15px', borderRadius: '8px' }}>
        <h3 style={{ borderBottom: '1px solid gray', paddingBottom: '10px', marginBottom: '10px' }}>Last Delivery</h3>
        {matchData.history?.length > 0 ? (
          <div style={{ fontSize: '16px' }}>
            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>
              [{matchData.overNumber}.{matchData.ballNumber === 0 ? 6 : matchData.ballNumber}]
            </span>{' '}
            {matchData.history[matchData.history.length - 1].commentary}
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>No deliveries yet.</p>
        )}
      </div>

      <div style={{ textAlign: 'center' }}>
        <button onClick={leaveLobby} className="button secondary" style={{ maxWidth: '200px' }}>Leave Match</button>
      </div>
    </div>
  );
}
