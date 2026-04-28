import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const ENGINE_CONFIG = {
  TURN_TIMER_SEC: 30,
  VERSION: '2.1.0',
  CONSECUTIVE_LIMIT: 2,
  PRESSURE_OVERS: 2,
  REVEAL_DELAY_MS: 700,   // pause before showing result
  NEXT_BALL_DELAY_MS: 2500, // pause after result before clearing
};

// ─── RUN CARDS — cricket-themed ──────────────────────────────────────────────
const RUN_CARDS = [
  { value: 0, label: 'Dot',    sublabel: 'Defensive',  color: 'rgba(144, 164, 174, 0.9)',  border: '#90A4AE', icon: '🏏' },
  { value: 1, label: '1 Run',  sublabel: 'Safe',       color: 'rgba(21, 101, 192, 0.9)',   border: '#64B5F6', icon: '🏃' },
  { value: 2, label: '2 Runs', sublabel: 'Balanced',   color: 'rgba(46, 125, 50, 0.9)',    border: '#81C784', icon: '⚡' },
  { value: 3, label: '3 Runs', sublabel: 'Risky',      color: 'rgba(121, 85, 72, 0.9)',    border: '#A1887F', icon: '🎯' },
  { value: 4, label: 'FOUR',   sublabel: 'Boundary',   color: 'rgba(251, 140, 0, 0.9)',    border: '#FB8C00', icon: '🔥' },
  { value: 6, label: 'SIX',    sublabel: 'Maximum',    color: 'rgba(255, 215, 0, 0.9)',    border: '#FFD700', icon: '💥' },
];

// ─── BOWLING STYLES — cricket-themed ─────────────────────────────────────────
const BOWL_STYLES = [
  { value: 'defend', label: 'Defend', sublabel: 'Tight line',  color: 'rgba(21, 101, 192, 0.9)',  border: '#64B5F6', icon: '🛡️' },
  { value: 'normal', label: 'Normal', sublabel: 'Steady pace', color: 'rgba(46, 125, 50, 0.9)',   border: '#81C784', icon: '⚾' },
  { value: 'attack', label: 'Attack', sublabel: 'Wicket ball', color: 'rgba(198, 40, 40, 0.9)',   border: '#EF9A9A', icon: '⚔️' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function resolveName(uid, lobbyData) {
  if (!uid) return '—';
  const p = lobbyData?.players?.[uid];
  if (p) return p.name;
  if (uid.startsWith('bot_')) return 'Bot';
  return uid.slice(0, 8) + '…';
}

function isPressure(overNumber, totalOvers) {
  return overNumber >= totalOvers - ENGINE_CONFIG.PRESSURE_OVERS;
}

function emptyStats() {
  return { runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, runsConceded: 0, ballsBowled: 0 };
}

function randomBotBatting() {
  const weights = [0.12, 0.28, 0.25, 0.12, 0.14, 0.09];
  const r = Math.random(); let cum = 0;
  for (let i = 0; i < weights.length; i++) { cum += weights[i]; if (r < cum) return { runAttempt: RUN_CARDS[i].value }; }
  return { runAttempt: 1 };
}

function randomBotBowling() {
  const s = ['defend', 'normal', 'attack'];
  return { style: s[Math.floor(Math.random() * s.length)] };
}

// ─── ENGINE ───────────────────────────────────────────────────────────────────
function evaluateOutcome(bowlStyle, runAttempt, pressure) {
  const r = Math.random();
  const pm = pressure ? 1.35 : 1.0;

  const wicketBase = { defend: 0.06, normal: 0.12, attack: 0.22 };
  const boundaryBase = { 0: 0.02, 1: 0.04, 2: 0.08, 3: 0.14, 4: 0.32, 6: 0.52 };

  const wicketChance = wicketBase[bowlStyle] * pm;
  const boundaryChance = boundaryBase[runAttempt] * pm;

  // Wicket roll — attack vs dot = more danger; attack vs six = less (batsman goes for it)
  let wicketRoll = r;
  if (bowlStyle === 'attack' && runAttempt >= 4) wicketRoll *= 0.65;
  if (runAttempt === 0 && bowlStyle === 'attack') wicketRoll *= 0.55;

  if (wicketRoll < wicketChance) {
    const types = ['bowled', 'caught', 'lbw', 'run out'];
    const tw = bowlStyle === 'attack' ? [0.30, 0.40, 0.20, 0.10] : [0.25, 0.25, 0.35, 0.15];
    let wt = 'caught', cum = 0, roll = Math.random();
    for (let i = 0; i < types.length; i++) { cum += tw[i]; if (roll < cum) { wt = types[i]; break; } }
    const pool = {
      bowled:   ['Timber! The stumps are shattered!', 'Clean bowled! What a delivery!', 'Beaten all ends up — BOWLED!'],
      caught:   ['Skied it... and taken! CAUGHT!', 'Finds the fielder perfectly. OUT!', 'Straight down the throat — CAUGHT!'],
      lbw:      ['Plumb in front! Finger goes up. LBW!', 'Trapped on the crease — LBW!', 'Big appeal... and given! LBW!'],
      'run out':['Mix up in the middle! Direct hit — RUN OUT!', 'Sent back too late — RUN OUT!'],
    };
    const c = pool[wt]; return { runs: 0, isWicket: true, wicketType: wt, commentary: c[Math.floor(Math.random() * c.length)], resultType: 'wicket' };
  }

  if (r < boundaryChance) {
    if (runAttempt === 6) {
      const c = ["Absolutely smashed! That's a SIX!", "Into the stands! Massive SIX!", "Cleared the rope with ease! SIX!", "That's gone all the way! SIX!"];
      return { runs: 6, isWicket: false, wicketType: null, commentary: c[Math.floor(Math.random() * c.length)], resultType: 'six' };
    }
    if (runAttempt >= 4) {
      const c = ['Cracked through the gap! FOUR!', 'Races away to the boundary! FOUR!', 'Pierces the field perfectly! FOUR!', 'Timed to perfection — FOUR!'];
      return { runs: 4, isWicket: false, wicketType: null, commentary: c[Math.floor(Math.random() * c.length)], resultType: 'boundary' };
    }
  }

  const bothDefensive = bowlStyle === 'defend' && runAttempt === 0;
  if (bothDefensive || (bowlStyle === 'defend' && runAttempt <= 1 && r > 0.52)) {
    const c = ['Dot ball. Pressure building.', 'Defended solidly. No run.', 'Tight line, nothing to hit.', 'Maiden territory — dot ball.'];
    return { runs: 0, isWicket: false, wicketType: null, commentary: c[Math.floor(Math.random() * c.length)], resultType: 'dot' };
  }

  const actual = Math.min(runAttempt, Math.max(0, runAttempt - Math.floor(Math.random() * 2)));
  const c = [`${actual} run${actual !== 1 ? 's' : ''} taken.`, `Pushed into the gap for ${actual}.`, `Worked away for ${actual}.`, `${actual} off that delivery.`];
  return { runs: actual, isWicket: false, wicketType: null, commentary: c[Math.floor(Math.random() * c.length)], resultType: actual === 0 ? 'dot' : 'runs' };
}

// ─── SCORECARD COMPONENT ──────────────────────────────────────────────────────
function Scorecard({ matchData, lobbyData }) {
  const stats = matchData.playerStats || {};
  const teamAIds = matchData.teamLists?.A || [];
  const teamBIds = matchData.teamLists?.B || [];

  function sr(runs, balls) { return balls === 0 ? '—' : ((runs / balls) * 100).toFixed(0); }
  function econ(runs, balls) { return balls === 0 ? '—' : ((runs / balls) * 6).toFixed(1); }
  function overs(balls) { return `${Math.floor(balls / 6)}.${balls % 6}`; }

  const thStyle = { textAlign: 'left', padding: '5px 8px', color: 'var(--text-muted)', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '1px solid rgba(255,255,255,0.12)' };
  const tdStyle = { padding: '6px 8px', fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.06)' };
  const tdCenter = { ...tdStyle, textAlign: 'center' };

  const renderBatting = (ids, teamName, teamColor) => (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontWeight: 700, color: teamColor, marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: '3px', height: '14px', background: teamColor, borderRadius: '2px', display: 'inline-block' }} />
        {teamName} — Batting
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Player</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>R</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>B</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>4s</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>6s</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>SR</th>
          </tr>
        </thead>
        <tbody>
          {ids.map(uid => {
            const s = stats[uid] || emptyStats();
            const isOut = (matchData.outPlayers || []).includes(uid);
            return (
              <tr key={uid} style={{ opacity: isOut ? 0.5 : 1 }}>
                <td style={tdStyle}>{resolveName(uid, lobbyData)}{isOut ? ' †' : ''}</td>
                <td style={{ ...tdCenter, fontWeight: 700, color: s.runs >= 50 ? 'var(--six-color)' : 'var(--text-primary)' }}>{s.runs}</td>
                <td style={{ ...tdCenter, color: 'var(--text-secondary)' }}>{s.balls}</td>
                <td style={{ ...tdCenter, color: 'var(--four-color)' }}>{s.fours}</td>
                <td style={{ ...tdCenter, color: 'var(--six-color)' }}>{s.sixes}</td>
                <td style={{ ...tdCenter, color: 'var(--text-muted)' }}>{sr(s.runs, s.balls)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderBowling = (ids, teamName, teamColor) => {
    const bowlers = ids.filter(uid => (stats[uid]?.ballsBowled || 0) > 0);
    if (!bowlers.length) return null;
    return (
      <div style={{ marginBottom: '18px' }}>
        <div style={{ fontWeight: 700, color: teamColor, marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '3px', height: '14px', background: teamColor, borderRadius: '2px', display: 'inline-block' }} />
          {teamName} — Bowling
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Player</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>O</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>R</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>W</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Eco</th>
            </tr>
          </thead>
          <tbody>
            {bowlers.map(uid => {
              const s = stats[uid] || emptyStats();
              return (
                <tr key={uid}>
                  <td style={tdStyle}>{resolveName(uid, lobbyData)}</td>
                  <td style={{ ...tdCenter, color: 'var(--text-secondary)' }}>{overs(s.ballsBowled)}</td>
                  <td style={tdCenter}>{s.runsConceded}</td>
                  <td style={{ ...tdCenter, fontWeight: 700, color: s.wickets > 0 ? 'var(--wicket-color)' : 'var(--text-primary)' }}>{s.wickets}</td>
                  <td style={{ ...tdCenter, color: 'var(--text-muted)' }}>{econ(s.runsConceded, s.ballsBowled)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="pitch-panel">
      {renderBatting(teamAIds, lobbyData.teamAName, 'var(--team-a)')}
      {renderBatting(teamBIds, lobbyData.teamBName, 'var(--team-b)')}
      <hr className="crease" />
      {renderBowling(teamBIds, lobbyData.teamBName, 'var(--team-b)')}
      {renderBowling(teamAIds, lobbyData.teamAName, 'var(--team-a)')}
    </div>
  );
}

// ─── CARD BUTTON ──────────────────────────────────────────────────────────────
function CardButton({ card, selected, onSelect, disabled }) {
  return (
    <button onClick={() => !disabled && onSelect(card.value)} disabled={disabled} style={{
      background: selected ? card.color : 'rgba(255,255,255,0.04)',
      border: `2px solid ${selected ? card.border : 'rgba(255,255,255,0.1)'}`,
      borderRadius: '12px', padding: '12px 6px', cursor: disabled ? 'not-allowed' : 'pointer',
      color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
      transition: 'all 0.15s ease', transform: selected ? 'scale(1.08)' : 'scale(1)',
      boxShadow: selected ? `0 0 18px ${card.border}55` : 'none',
      minWidth: '64px', flex: 1, opacity: disabled ? 0.45 : 1,
    }}>
      <span style={{ fontSize: '20px' }}>{card.icon}</span>
      <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{card.label}</span>
      <span style={{ fontSize: '9px', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.sublabel}</span>
    </button>
  );
}

// ─── STYLE BUTTON ─────────────────────────────────────────────────────────────
function StyleButton({ style, selected, onSelect, disabled }) {
  return (
    <button onClick={() => !disabled && onSelect(style.value)} disabled={disabled} style={{
      background: selected ? style.color : 'rgba(255,255,255,0.04)',
      border: `2px solid ${selected ? style.border : 'rgba(255,255,255,0.1)'}`,
      borderRadius: '12px', padding: '16px 10px', cursor: disabled ? 'not-allowed' : 'pointer',
      color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      transition: 'all 0.15s ease', transform: selected ? 'scale(1.08)' : 'scale(1)',
      boxShadow: selected ? `0 0 18px ${style.border}55` : 'none',
      flex: 1, opacity: disabled ? 0.45 : 1,
    }}>
      <span style={{ fontSize: '26px' }}>{style.icon}</span>
      <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{style.label}</span>
      <span style={{ fontSize: '10px', opacity: 0.65 }}>{style.sublabel}</span>
    </button>
  );
}

// ─── REVEAL PANEL ─────────────────────────────────────────────────────────────
function RevealPanel({ result }) {
  const [phase, setPhase] = useState('pending'); // pending → revealing → show

  useEffect(() => {
    if (!result) return;
    setPhase('revealing');
    const t = setTimeout(() => setPhase('show'), ENGINE_CONFIG.REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [result?.commentary]);

  if (!result) return null;

  const cfg = {
    wicket:   { bg: 'linear-gradient(135deg, #7f0000, #D32F2F)', icon: '☝️', accent: '#FFEBEE', label: 'WICKET!',   anim: 'anim-wicket' },
    six:      { bg: 'linear-gradient(135deg, #FFD700, #FFA000)', icon: '💥', accent: '#FFFFFF', label: 'SIX!',      anim: 'anim-six' },
    boundary: { bg: 'linear-gradient(135deg, #FB8C00, #E65100)', icon: '🔥', accent: '#FFF3E0', label: 'FOUR!',     anim: 'anim-fadein' },
    dot:      { bg: 'linear-gradient(135deg, #455A64, #78909C)', icon: '🛡️', accent: '#CFD8DC', label: 'DOT BALL',  anim: 'anim-dot' },
    runs:     { bg: 'linear-gradient(135deg, #2E7D32, #1B5E20)', icon: '⚡', accent: '#C8E6C9', label: `${result.runs} RUN${result.runs !== 1 ? 'S' : ''}`, anim: 'anim-fadein' },
  }[result.resultType] || { bg: '#263238', icon: '⚡', accent: '#90A4AE', label: '...', anim: '' };

  const bowlCard = BOWL_STYLES.find(s => s.value === result.bowlStyle);
  const runCard  = RUN_CARDS.find(c => c.value === result.runAttempt);

  return (
    <div className={`anim-slideup ${phase === 'show' ? cfg.anim : ''}`} style={{
      background: cfg.bg, border: `1px solid ${cfg.accent}55`, borderRadius: '12px',
      padding: '22px', textAlign: 'center',
      boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${cfg.accent}22`,
    }}>
      {/* Choices revealed after delay */}
      {phase === 'show' && bowlCard && runCard && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '16px', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', border: `1px solid ${bowlCard.border}44` }}>
            <div style={{ opacity: 0.55, marginBottom: '3px', fontSize: '11px' }}>BOWLER</div>
            <div>{bowlCard.icon} {bowlCard.label}</div>
          </div>
          <div style={{ color: cfg.accent, fontSize: '18px', alignSelf: 'center', fontWeight: 'bold' }}>vs</div>
          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', border: `1px solid ${runCard.border}44` }}>
            <div style={{ opacity: 0.55, marginBottom: '3px', fontSize: '11px' }}>BATSMAN</div>
            <div>{runCard.icon} {runCard.label}</div>
          </div>
        </div>
      )}
      <div style={{ fontSize: '50px', marginBottom: '8px' }}>
        {phase === 'revealing' ? '⚡' : cfg.icon}
      </div>
      <div style={{ fontSize: '30px', fontWeight: 'bold', color: cfg.accent, marginBottom: '8px', letterSpacing: '1px' }}>
        {phase === 'revealing' ? 'REVEALING...' : cfg.label}
      </div>
      {phase === 'show' && (
        <div style={{ fontSize: '14px', opacity: 0.85, fontStyle: 'italic', animation: 'fadeIn 0.4s ease' }}>
          {result.commentary}
        </div>
      )}
    </div>
  );
}

// ─── MAIN MATCH COMPONENT ─────────────────────────────────────────────────────
export default function Match({ lobbyData, matchId, leaveLobby }) {
  const { currentUser } = useAuth();
  const [matchData, setMatchData]     = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedStyle, setSelectedStyle] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [timeLeft, setTimeLeft]       = useState(ENGINE_CONFIG.TURN_TIMER_SEC);
  const [lastResult, setLastResult]   = useState(null);
  const [showScorecard, setShowScorecard] = useState(false);
  // Controls whether action panels are visible (hidden briefly after result)
  const [actionsReady, setActionsReady] = useState(true);
  const timerBallRef = useRef(null);
  const imHost = lobbyData.hostId === currentUser.uid;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'matches', matchId), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setMatchData(data);
        if (data.lastResult) {
          setLastResult(prev => {
            // Only update if it's a truly new result (different commentary or different ball)
            if (prev?.commentary === data.lastResult.commentary && 
                prev?.ballNumber === data.lastResult.ballNumber &&
                prev?.overNumber === data.lastResult.overNumber) {
              return prev;
            }
            return data.lastResult;
          });
        }
      }
    });
    return () => unsub();
  }, [matchId]);

  // Timer — resets only on new ball, not every snapshot
  useEffect(() => {
    if (!matchData || matchData.status !== 'in-progress') return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) return;
    const key = `${matchData.innings}-${matchData.overNumber}-${matchData.ballNumber}`;
    if (timerBallRef.current === key) return;
    timerBallRef.current = key;
    setTimeLeft(ENGINE_CONFIG.TURN_TIMER_SEC);
    setLastResult(null);
    setActionsReady(true);
    setSelectedRun(null);
    setSelectedStyle(null);
    const iv = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(iv); if (imHost) forceTimeout(matchData); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [matchData?.innings, matchData?.overNumber, matchData?.ballNumber, matchData?.status]);

  // After result arrives, hide action panels briefly for pacing
  useEffect(() => {
    if (!lastResult) return;
    setActionsReady(false);
    // Use a unique key to ensure the delay always triggers for a new ball result
    const t = setTimeout(() => setActionsReady(true), ENGINE_CONFIG.NEXT_BALL_DELAY_MS);
    return () => clearTimeout(t);
  }, [lastResult?.commentary, lastResult?.ballNumber, lastResult?.overNumber]);

  function forceTimeout(m) {
    const u = {};
    if (!m.ballInput?.bowler) u['ballInput.bowler'] = randomBotBowling();
    if (!m.ballInput?.batsman) u['ballInput.batsman'] = randomBotBatting();
    if (Object.keys(u).length) updateDoc(doc(db, 'matches', matchId), u);
  }

  // Auto-bot
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress' || matchData.processingResult) return;
    const bIn = matchData.ballInput?.bowler, batIn = matchData.ballInput?.batsman;
    const t = setTimeout(() => {
      if (!bIn && matchData.currentBowlerId?.startsWith('bot_'))
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': randomBotBowling() });
      if (!batIn && matchData.strikerId?.startsWith('bot_'))
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': randomBotBatting() });
    }, 900);
    return () => clearTimeout(t);
  }, [
    matchData?.status, matchData?.strikerId, matchData?.currentBowlerId,
    matchData?.ballNumber, matchData?.overNumber, matchData?.innings,
    matchData?.processingResult, !!matchData?.ballInput?.bowler, !!matchData?.ballInput?.batsman,
  ]);

  // Engine — host only
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress' || matchData.processingResult) return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) processBall(matchData);
  }, [matchData]);

  // Deadlock recovery
  useEffect(() => {
    if (!matchData || !imHost || !matchData.processingResult) return;
    const t = setTimeout(() => updateDoc(doc(db, 'matches', matchId), { processingResult: false, ballInput: { bowler: null, batsman: null } }), 20000);
    return () => clearTimeout(t);
  }, [matchData?.processingResult]);

  // Over-break: NO auto-select — captain must choose manually
  // Bot bowling captain auto-selects
  useEffect(() => {
    if (!matchData || matchData.status !== 'over-break' || !imHost) return;
    const bowlingCap = Object.values(lobbyData.players).find(p => p.team === matchData.bowlingTeam && p.isCaptain);
    if (!bowlingCap?.isBot) return;
    const roster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
    const eligible = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
    const pool = eligible.length > 0 ? eligible : roster;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      const t = setTimeout(() => updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: pick.uid }), 1200);
      return () => clearTimeout(t);
    }
  }, [matchData?.status, matchData?.overNumber]);

  // Toss bot
  useEffect(() => {
    if (!matchData || !imHost) return;
    if (matchData.status === 'toss' && !matchData.tossCall) {
      const cap = Object.values(lobbyData.players).find(p => p.team === matchData.tossCallerTeam && p.isCaptain);
      if (cap?.isBot) {
        const coin = Math.random() > 0.5 ? 'heads' : 'tails';
        const winner = coin === 'heads' ? matchData.tossCallerTeam : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
        const t = setTimeout(() => updateDoc(doc(db, 'matches', matchId), { tossCall: 'heads', tossCoinResult: coin, tossWinnerTeam: winner }), 900);
        return () => clearTimeout(t);
      }
    }
    if (matchData.status === 'toss' && matchData.tossWinnerTeam && !matchData.tossChoice) {
      const cap = Object.values(lobbyData.players).find(p => p.team === matchData.tossWinnerTeam && p.isCaptain);
      if (cap?.isBot) {
        const t = setTimeout(() => submitTossChoice('bat', matchData), 1200);
        return () => clearTimeout(t);
      }
    }
  }, [matchData?.status, matchData?.tossCall, matchData?.tossWinnerTeam, matchData?.tossChoice]);

  async function processBall(m) {
    await updateDoc(doc(db, 'matches', matchId), { processingResult: true });
    const bowlStyle  = m.ballInput.bowler.style;
    const runAttempt = m.ballInput.batsman.runAttempt;
    const pressure   = isPressure(m.overNumber, m.totalOvers);

    let { runs, isWicket, wicketType, commentary, resultType } = evaluateOutcome(bowlStyle, runAttempt, pressure);

    // Consecutive limits
    if (runs === 6 && (m.consecSixes || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) {
      runs = 4; commentary = 'One bounce over the rope — FOUR!'; resultType = 'boundary';
    }
    if (isWicket && (m.consecWickets || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) {
      isWicket = false; runs = 1; commentary = 'Edged but falls short! Single taken.'; resultType = 'runs'; wicketType = null;
    }

    const consecSixes   = runs === 6 ? (m.consecSixes || 0) + 1 : 0;
    const consecWickets = isWicket ? (m.consecWickets || 0) + 1 : 0;

    // ── Player stats update ──────────────────────────────────────────────────
    const stats = JSON.parse(JSON.stringify(m.playerStats || {}));
    const batsmanId = m.strikerId;
    const bowlerId  = m.currentBowlerId;
    if (batsmanId) {
      if (!stats[batsmanId]) stats[batsmanId] = emptyStats();
      stats[batsmanId].runs  += runs;
      stats[batsmanId].balls += 1;
      if (runs === 4) stats[batsmanId].fours += 1;
      if (runs === 6) stats[batsmanId].sixes += 1;
    }
    if (bowlerId) {
      if (!stats[bowlerId]) stats[bowlerId] = emptyStats();
      stats[bowlerId].runsConceded += runs;
      stats[bowlerId].ballsBowled  += 1;
      if (isWicket && wicketType !== 'run out') stats[bowlerId].wickets += 1;
    }

    const resultRecord = { bowlStyle, runAttempt, runs, isWicket, wicketType, commentary, resultType, pressure };

    let nextScore   = m.score + runs;
    let nextWickets = m.wickets + (isWicket ? 1 : 0);
    let nextBall    = m.ballNumber + 1;
    let nextOver    = m.overNumber;
    let overComplete = false;
    let swappedStriker    = m.strikerId;
    let swappedNonStriker = m.nonStrikerId;

    if (runs % 2 !== 0 && m.nonStrikerId) { swappedStriker = m.nonStrikerId; swappedNonStriker = m.strikerId; }
    if (nextBall === 6) {
      nextBall = 0; nextOver += 1; overComplete = true;
      if (m.nonStrikerId) { const tmp = swappedStriker; swappedStriker = swappedNonStriker; swappedNonStriker = tmp; }
    }

    const nextOutPlayers = [...(m.outPlayers || [])];
    if (isWicket) nextOutPlayers.push(m.strikerId);

    const teamList = m.teamLists?.[m.battingTeam] || [];
    const maxWickets = m.lastManStand
      ? teamList.length
      : Math.max(1, teamList.length - 1);
    const endOfInnings   = nextWickets >= maxWickets || nextOver >= m.totalOvers;
    const chaseSucceeded = m.innings === 2 && nextScore >= m.target;
    const chaseFailed    = m.innings === 2 && endOfInnings && nextScore < m.target;
    const isTie          = m.innings === 2 && endOfInnings && nextScore === m.target - 1 && !chaseSucceeded;
    const matchEnded     = chaseSucceeded || chaseFailed || isTie;

    if (matchEnded) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: isTie ? 'completed-tie' : 'completed',
        score: nextScore, wickets: nextWickets,
        innings2Score: nextScore, innings2Wickets: nextWickets,
        history: [...(m.history || []), resultRecord],
        lastResult: resultRecord, playerStats: stats,
        ballInput: { bowler: null, batsman: null }, processingResult: false,
      }); return;
    }

    if (endOfInnings) {
      // Save innings 1 data separately, reset for innings 2
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'innings-break',
        innings: 2,
        innings1Score: nextScore, innings1Wickets: nextWickets,
        innings1History: [...(m.history || []), resultRecord],
        battingTeam: m.bowlingTeam, bowlingTeam: m.battingTeam,
        target: nextScore + 1,
        score: 0, wickets: 0, ballNumber: 0, overNumber: 0, outPlayers: [],
        history: [],   // fresh history for innings 2
        strikerId: m.teamLists[m.bowlingTeam][0],
        nonStrikerId: m.teamLists[m.bowlingTeam].length > 1 ? m.teamLists[m.bowlingTeam][1] : null,
        currentBowlerId: m.teamLists[m.battingTeam][0],
        lastResult: resultRecord, playerStats: stats,
        ballInput: { bowler: null, batsman: null },
        consecSixes: 0, consecWickets: 0, processingResult: false,
        lastOverBowlerId: null,
      });
      // Auto-transition to in-progress after 5s
      setTimeout(() => updateDoc(doc(db, 'matches', matchId), { status: 'in-progress' }), 5000);
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
        strikerId: nextStriker, nonStrikerId: swappedNonStriker, outPlayers: nextOutPlayers,
        lastOverBowlerId: m.currentBowlerId,
        history: [...(m.history || []), resultRecord],
        lastResult: resultRecord, playerStats: stats,
        ballInput: { bowler: null, batsman: null },
        consecSixes, consecWickets, processingResult: false,
      }); return;
    }

    await updateDoc(doc(db, 'matches', matchId), {
      score: nextScore, wickets: nextWickets, ballNumber: nextBall, overNumber: nextOver,
      strikerId: nextStriker, nonStrikerId: swappedNonStriker,
      currentBowlerId: m.currentBowlerId, lastOverBowlerId: m.lastOverBowlerId || null,
      outPlayers: nextOutPlayers,
      history: [...(m.history || []), resultRecord],
      lastResult: resultRecord, playerStats: stats,
      ballInput: { bowler: null, batsman: null },
      consecSixes, consecWickets, processingResult: false,
    });
  }

  async function submitBowling() {
    if (!selectedStyle || loading || !matchData) return;
    if (matchData.currentBowlerId !== currentUser?.uid || matchData.ballInput?.bowler) return;
    try {
      setLoading(true);
      await updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': { style: selectedStyle, submittedBy: currentUser.uid } });
    } catch (err) {
      console.error("Bowling submission failed:", err);
      alert("Failed to lock delivery. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitBatting() {
    if (selectedRun === null || loading || !matchData) return;
    if (matchData.strikerId !== currentUser?.uid || matchData.ballInput?.batsman) return;
    try {
      setLoading(true);
      await updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': { runAttempt: selectedRun, submittedBy: currentUser.uid } });
    } catch (err) {
      console.error("Batting submission failed:", err);
      alert("Failed to lock shot. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitNextBowler(uid) {
    await updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: uid });
  }

  async function submitTossCall(call) {
    try {
      const coin   = Math.random() > 0.5 ? 'heads' : 'tails';
      const winner = coin === call ? matchData.tossCallerTeam : (matchData.tossCallerTeam === 'A' ? 'B' : 'A');
      await updateDoc(doc(db, 'matches', matchId), { tossCall: call, tossCoinResult: coin, tossWinnerTeam: winner });
    } catch (err) {
      console.error("Toss call failed:", err);
      alert("Failed to submit toss call: " + err.message);
    }
  }

  async function submitTossChoice(choice, m) {
    try {
      const md = m || matchData;
      if (!md?.teamLists) throw new Error("Match data incomplete (teamLists missing)");
      
      const batFirst  = choice === 'bat' ? md.tossWinnerTeam : (md.tossWinnerTeam === 'A' ? 'B' : 'A');
      const bowlFirst = batFirst === 'A' ? 'B' : 'A';
      const aIds = md.teamLists.A || [], bIds = md.teamLists.B || [];
      
      if (!aIds.length || !bIds.length) throw new Error("Teams are empty");

      await updateDoc(doc(db, 'matches', matchId), {
        status: 'in-progress', tossChoice: choice, innings: 1,
        battingTeam: batFirst, bowlingTeam: bowlFirst,
        score: 0, wickets: 0, target: null, ballNumber: 0, overNumber: 0,
        strikerId:    batFirst === 'A' ? aIds[0] : bIds[0],
        nonStrikerId: batFirst === 'A' ? (aIds.length > 1 ? aIds[1] : null) : (bIds.length > 1 ? bIds[1] : null),
        currentBowlerId: bowlFirst === 'A' ? aIds[0] : bIds[0],
        playerStats: {},
      });
    } catch (err) {
      console.error("Toss choice failed:", err);
      alert("Failed to submit toss choice: " + err.message);
    }
  }

  if (!matchData) return <div className="container center" style={{ color: 'white' }}>Loading Match...</div>;

  const isMyTurnToBowl = matchData.currentBowlerId === currentUser.uid;
  const me = lobbyData?.players?.[currentUser.uid] || null;
  const isHost = lobbyData?.hostId === currentUser.uid;
  const isAllReady = lobbyData?.players && Object.values(lobbyData.players).length >= 2 && Object.values(lobbyData.players).every(p => p.isReady);
  const isValidTeams = lobbyData?.teamLists?.A?.length > 0 && lobbyData?.teamLists?.A?.length === lobbyData?.teamLists?.B?.length;
  const isMyTurnToBat  = matchData.strikerId === currentUser.uid;
  const isNonStriker   = matchData.nonStrikerId === currentUser.uid;
  const amBowlingCap   = lobbyData?.players && !!Object.values(lobbyData.players).find(p => p.uid === currentUser.uid && p.team === matchData.bowlingTeam && p.isCaptain);
  const strikerName    = resolveName(matchData.strikerId, lobbyData);
  const nonStrikerName = resolveName(matchData.nonStrikerId, lobbyData);
  const bowlerName     = resolveName(matchData.currentBowlerId, lobbyData);
  const pressure       = matchData.overNumber !== undefined && isPressure(matchData.overNumber, matchData.totalOvers);

  // DEBUG turn info if player is confused
  useEffect(() => {
    if (matchData?.status === 'in-progress') {
      console.log(`[Match Debug] UID: ${currentUser?.uid}, Striker: ${matchData.strikerId}, Bowler: ${matchData.currentBowlerId}`);
    }
  }, [matchData?.strikerId, matchData?.currentBowlerId, matchData?.status]);
  const bothLocked     = !!(matchData.ballInput?.bowler && matchData.ballInput?.batsman);
  const teamAName      = lobbyData?.teamAName || 'Team A';
  const teamBName      = lobbyData?.teamBName || 'Team B';
  const battingTeamName  = matchData.battingTeam  === 'A' ? teamAName : teamBName;
  const bowlingTeamName  = matchData.bowlingTeam  === 'A' ? teamAName : teamBName;

  // ── TOSS ─────────────────────────────────────────────────────────────────────
  if (matchData.status === 'toss') {
    const players = Object.values(lobbyData.players || {});
    const callerName = matchData.tossCallerTeam === 'A' ? teamAName : teamBName;
    
    // Fallback: If no official captain is found, use the first human on that team
    const findCap = (team) => {
      const teamPlayers = players.filter(p => p.team === team);
      const official = teamPlayers.find(p => p.isCaptain);
      if (official) return official.uid === currentUser.uid;
      // Fallback to first human
      const firstHuman = teamPlayers.find(p => !p.isBot);
      return firstHuman?.uid === currentUser.uid;
    };

    const iAmCaller  = findCap(matchData.tossCallerTeam);
    const flipped    = !!matchData.tossCoinResult;
    const winnerName = matchData.tossWinnerTeam === 'A' ? teamAName : teamBName;
    const iAmWinner  = findCap(matchData.tossWinnerTeam);
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '440px' }}>
        <div className="card" style={{ maxWidth: '440px' }}>
          <div style={{ fontSize: '64px', marginBottom: '10px' }}>🪙</div>
          <h2 style={{ marginBottom: '6px' }}>The Toss</h2>
          <hr className="crease" />
          {!flipped ? (
            <>
              <p style={{ color: 'var(--text-secondary)', margin: '16px 0' }}>
                <strong style={{ color: 'white' }}>{callerName}</strong> captain calls the toss
              </p>
              {iAmCaller
                ? <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => submitTossCall('heads')} className="button primary" style={{ flex: 1 }}>🪙 Heads</button>
                    <button onClick={() => submitTossCall('tails')} className="button secondary" style={{ flex: 1 }}>🔄 Tails</button>
                  </div>
                : <p style={{ color: 'var(--text-muted)' }}>Waiting for {callerName} captain...</p>}
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-secondary)', margin: '14px 0 6px' }}>
                {callerName} called <strong style={{ color: 'white', textTransform: 'capitalize' }}>{matchData.tossCall}</strong>
              </p>
              <p style={{ fontSize: '20px', marginBottom: '14px' }}>
                Coin: <strong style={{ color: matchData.tossCoinResult === matchData.tossCall ? 'var(--success-color)' : 'var(--error-color)', textTransform: 'capitalize' }}>{matchData.tossCoinResult}</strong>
              </p>
              <div style={{ background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)', padding: '12px', borderRadius: '8px', marginBottom: '18px' }}>
                <span style={{ color: '#FFD700', fontWeight: 700, fontSize: '17px' }}>{winnerName} wins the toss!</span>
              </div>
              {iAmWinner
                ? <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => submitTossChoice('bat', matchData)} className="button primary" style={{ flex: 1 }}>🏏 Bat First</button>
                    <button onClick={() => submitTossChoice('bowl', matchData)} className="button secondary" style={{ flex: 1 }}>🎳 Bowl First</button>
                  </div>
                : <p style={{ color: 'var(--text-muted)' }}>Waiting for {winnerName} captain to choose...</p>}
            </>
          )}
          <hr className="crease" style={{ marginTop: '20px' }} />
          <button onClick={leaveLobby} className="button secondary" style={{ marginTop: '4px' }}>Leave</button>
        </div>
      </div>
    );
  }

  // ── INNINGS BREAK ─────────────────────────────────────────────────────────────
  if (matchData.status === 'innings-break') {
    const chasingTeam = matchData.battingTeam === 'A' ? teamAName : teamBName;
    const chasingColor = matchData.battingTeam === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '16px', maxWidth: '440px' }}>
        <div className="card" style={{ maxWidth: '440px' }}>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>🏏</div>
          <h2 style={{ marginBottom: '4px' }}>Innings Break</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
            1st innings: <strong style={{ color: 'white' }}>{matchData.innings1Score}/{matchData.innings1Wickets}</strong>
          </p>
          <hr className="crease" />
          <div style={{ margin: '16px 0', padding: '16px', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.35)', borderRadius: '8px' }}>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFD700' }}>Target: {matchData.target}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '5px' }}>
              <span style={{ color: chasingColor, fontWeight: 600 }}>{chasingTeam}</span> need {matchData.target} in {matchData.totalOvers} overs
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>2nd innings starting shortly...</p>
        </div>
      </div>
    );
  }

  // ── MATCH SUMMARY ─────────────────────────────────────────────────────────────
  if (matchData.status === 'completed' || matchData.status === 'completed-tie') {
    const isTie = matchData.status === 'completed-tie';
    let resultLine = 'Match Tied!';
    if (!isTie) {
      const battingWon = matchData.innings === 2 && matchData.score >= matchData.target;
      const winTeam    = battingWon ? matchData.battingTeam : matchData.bowlingTeam;
      const winName    = winTeam === 'A' ? teamAName : teamBName;
      if (battingWon) {
        const maxWk = matchData.lastManStand ? matchData.teamLists[winTeam].length : Math.max(1, matchData.teamLists[winTeam].length - 1);
        const wkLeft = maxWk - matchData.wickets;
        resultLine = `${winName} won by ${wkLeft} wicket${wkLeft !== 1 ? 's' : ''}!`;
      } else {
        const margin = matchData.target - 1 - matchData.score;
        resultLine = `${winTeam === 'A' ? teamBName : teamAName} won by ${margin} run${margin !== 1 ? 's' : ''}!`;
      }
    }
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '16px', maxWidth: '680px' }}>
        {/* Trophy banner */}
        <div style={{ background: 'linear-gradient(135deg, rgba(74,20,140,0.85), rgba(183,28,28,0.85))', border: '1px solid rgba(255,215,0,0.4)', padding: '28px', borderRadius: '12px', width: '100%', backdropFilter: 'blur(10px)' }}>
          <div style={{ fontSize: '52px', marginBottom: '10px' }}>🏆</div>
          <h1 style={{ color: '#FFD700', marginBottom: '8px', fontSize: 'clamp(20px,4vw,28px)' }}>{resultLine}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            1st innings: {matchData.innings1Score}/{matchData.innings1Wickets} &nbsp;·&nbsp;
            2nd innings: {matchData.score}/{matchData.wickets}
          </p>
          {matchData.target && <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>Target was {matchData.target}</p>}
        </div>
        <Scorecard matchData={matchData} lobbyData={lobbyData} />
        <div className="pitch-panel" style={{ width: '100%', maxHeight: '220px', overflowY: 'auto', textAlign: 'left' }}>
          <h3 style={{ marginBottom: '10px', fontSize: '14px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Ball-by-Ball · 2nd Innings</h3>
          {(matchData.history || []).map((h, i) => (
            <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '11px', minWidth: '44px' }}>Ball {i + 1}</span>
              <span style={{ color: h.isWicket ? 'var(--wicket-color)' : h.runs >= 6 ? 'var(--six-color)' : h.runs >= 4 ? 'var(--four-color)' : 'var(--text-primary)', fontSize: '13px' }}>{h.commentary}</span>
            </div>
          ))}
        </div>
        <button onClick={leaveLobby} className="button secondary" style={{ maxWidth: '200px' }}>Leave Match</button>
      </div>
    );
  }

  // ── OVER BREAK ────────────────────────────────────────────────────────────────
  if (matchData.status === 'over-break') {
    const players = Object.values(lobbyData?.players || {});
    const roster   = players.filter(p => p.team === matchData.bowlingTeam);
    const eligible = roster.filter(p => p.uid !== matchData.lastOverBowlerId);
    const bowlerList = eligible.length > 0 ? eligible : roster;
    const bowlColor = matchData.bowlingTeam === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '16px', maxWidth: '440px' }}>
        <div className="card" style={{ maxWidth: '440px' }}>
          <h2 style={{ marginBottom: '4px' }}>Over Complete</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            {matchData.score}/{matchData.wickets} after {matchData.overNumber} over{matchData.overNumber !== 1 ? 's' : ''}
          </p>
          {matchData.target && (
            <p style={{ color: '#FFD700', fontSize: '13px', marginTop: '4px' }}>
              Need {matchData.target - matchData.score} off {(matchData.totalOvers - matchData.overNumber) * 6} balls
            </p>
          )}
          <hr className="crease" style={{ margin: '14px 0' }} />
          <h3 style={{ marginBottom: '12px', color: bowlColor }}>🎳 Select Next Bowler</h3>
          {amBowlingCap
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {bowlerList.map(p => (
                  <button key={p.uid} onClick={() => submitNextBowler(p.uid)} className="button primary"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: bowlColor }}>
                    {p.isBot ? '🤖' : '👤'} {p.name} {p.isCaptain ? '[C]' : ''}
                  </button>
                ))}
              </div>
            : <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Waiting for {bowlingTeamName} captain to select the next bowler...</p>}
        </div>
      </div>
    );
  }

  // ── IN-PROGRESS ───────────────────────────────────────────────────────────────
  const timerColor = timeLeft <= 5 ? 'var(--error-color)' : timeLeft <= 10 ? '#FB8C00' : 'white';
  const battingColor = matchData.battingTeam === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  const bowlingColor = matchData.bowlingTeam === 'A' ? 'var(--team-a)' : 'var(--team-b)';

  return (
    <div className="container" style={{ color: 'white', flexDirection: 'column', gap: '12px', maxWidth: '860px', margin: '0 auto' }}>

      {/* ── BROADCAST SCOREBOARD ── */}
      <div className="broadcast-panel anim-fadein" style={{ textAlign: 'center', position: 'relative', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '8px' }}>
          <span className="badge-live">Live</span>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}>
            Innings {matchData.innings} · Over {matchData.overNumber}.{matchData.ballNumber} / {matchData.totalOvers}
          </div>
        </div>
        {pressure && (
          <div style={{ position: 'absolute', top: '10px', left: '14px', color: 'var(--six-color)', fontSize: '10px', fontWeight: 900, letterSpacing: '1.5px', textTransform: 'uppercase', opacity: 0.8 }}>
            🔥 Death Overs
          </div>
        )}
        <div style={{ fontSize: '38px', fontWeight: 700, lineHeight: 1, color: 'white' }}>
          {matchData.score}<span style={{ fontSize: '20px', color: 'var(--text-muted)' }}>/{matchData.wickets}</span>
        </div>
        <div style={{ fontSize: '12px', color: battingColor, fontWeight: 600, marginTop: '3px' }}>{battingTeamName} batting</div>
        {matchData.target && (
          <div style={{ marginTop: '8px', padding: '4px 14px', background: 'rgba(255,215,0,0.15)', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '20px', display: 'inline-block', color: '#FFD700', fontSize: '13px', fontWeight: 600 }}>
            Need {matchData.target - matchData.score} off {(matchData.totalOvers - matchData.overNumber) * 6 - matchData.ballNumber} balls
          </div>
        )}
        {/* Timer */}
        <div style={{ position: 'absolute', top: '12px', right: '14px', background: 'rgba(0,0,0,0.5)', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ color: timerColor, fontWeight: 700, fontSize: '16px' }}>⏱ {timeLeft}s</span>
        </div>
        {/* Scorecard toggle */}
        <button onClick={() => setShowScorecard(s => !s)}
          style={{ position: 'absolute', bottom: '8px', right: '12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)', fontSize: '11px', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', minHeight: 'unset' }}>
          {showScorecard ? 'Hide' : '📊 Card'}
        </button>
      </div>

      {showScorecard && <Scorecard matchData={matchData} lobbyData={lobbyData} />}

      {/* ── PLAYERS ON FIELD ── */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { label: '🏏 On Strike', name: strikerName, color: battingColor, active: isMyTurnToBat },
          { label: '🏃 Non-Striker', name: nonStrikerName || '—', color: battingColor, active: isNonStriker },
          { label: '🎳 Bowler', name: bowlerName, color: bowlingColor, active: isMyTurnToBowl },
        ].map(({ label, name, color, active }) => (
          <div key={label} className="broadcast-panel" style={{
            flex: 1, padding: '10px 12px',
            border: active ? `1px solid ${color}` : '1px solid var(--overlay-border)',
            background: active ? `${color}22` : 'var(--overlay-bg)',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>{label}</div>
            <div style={{ fontWeight: 600, fontSize: '14px', color: active ? color : 'white' }}>{name}</div>
          </div>
        ))}
      </div>

      {/* ── ROLE BANNER ── */}
      {isMyTurnToBat && (
        <div style={{ background: `${battingColor}22`, border: `1px solid ${battingColor}`, padding: '8px 14px', borderRadius: '8px', fontSize: '13px', color: battingColor, textAlign: 'center', fontWeight: 600 }}>
          🏏 You are on strike — choose your run attempt
        </div>
      )}
      {isMyTurnToBowl && (
        <div style={{ background: `${bowlingColor}22`, border: `1px solid ${bowlingColor}`, padding: '8px 14px', borderRadius: '8px', fontSize: '13px', color: bowlingColor, textAlign: 'center', fontWeight: 600 }}>
          🎳 You are bowling — choose your style
        </div>
      )}
      {isNonStriker && !isMyTurnToBat && !isMyTurnToBowl && (
        <div style={{ background: 'rgba(144,164,174,0.1)', border: '1px solid rgba(144,164,174,0.3)', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', color: 'var(--dot-color)', textAlign: 'center' }}>
          🏃 You are the non-striker — waiting at the other end
        </div>
      )}

      {/* ── REVEAL PANEL ── */}
      {lastResult && <RevealPanel result={lastResult} />}

      {bothLocked && !lastResult && (
        <div className="broadcast-panel" style={{ padding: '16px', textAlign: 'center', color: '#FFD700', border: '1px solid rgba(255,215,0,0.3)', fontWeight: 600 }}>
          ⚡ Both decisions locked — revealing outcome...
        </div>
      )}

      {/* ── ACTION PANELS ── */}
      {!bothLocked && actionsReady && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>

          {/* Bowling */}
          <div className="pitch-panel" style={{ flex: 1, minWidth: '250px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: bowlingColor }}>🎳 {bowlingTeamName}</h3>
              {matchData.ballInput?.bowler && <span style={{ color: 'var(--success-color)', fontSize: '12px', fontWeight: 600 }}>✓ Locked</span>}
            </div>
            <hr className="crease" style={{ marginBottom: '12px' }} />
            {matchData.ballInput?.bowler ? (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--success-color)' }}>
                <div style={{ fontSize: '26px' }}>🔒</div>
                <div style={{ fontSize: '12px', marginTop: '5px', color: 'var(--text-secondary)' }}>Delivery locked — waiting for batsman</div>
              </div>
            ) : isMyTurnToBowl ? (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>Choose your bowling style:</p>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {BOWL_STYLES.map(s => <StyleButton key={s.value} style={s} selected={selectedStyle === s.value} onSelect={setSelectedStyle} disabled={loading} />)}
                </div>
                <button onClick={submitBowling} disabled={!selectedStyle || loading} className="button primary" style={{ background: bowlingColor }}>
                  {loading ? 'Locking...' : 'Lock Delivery 🔒'}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '24px', marginBottom: '5px' }}>⏳</div>
                <div style={{ fontSize: '12px' }}>Waiting for {bowlerName}...</div>
              </div>
            )}
          </div>

          {/* Batting */}
          <div className="pitch-panel" style={{ flex: 1, minWidth: '250px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: battingColor }}>🏏 {battingTeamName}</h3>
              {matchData.ballInput?.batsman && <span style={{ color: 'var(--success-color)', fontSize: '12px', fontWeight: 600 }}>✓ Locked</span>}
            </div>
            <hr className="crease" style={{ marginBottom: '12px' }} />
            {matchData.ballInput?.batsman ? (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--success-color)' }}>
                <div style={{ fontSize: '26px' }}>🔒</div>
                <div style={{ fontSize: '12px', marginTop: '5px', color: 'var(--text-secondary)' }}>Shot locked — waiting for bowler</div>
              </div>
            ) : isMyTurnToBat ? (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '10px' }}>Choose your run attempt:</p>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {RUN_CARDS.map(c => <CardButton key={c.value} card={c} selected={selectedRun === c.value} onSelect={setSelectedRun} disabled={loading} />)}
                </div>
                <button onClick={submitBatting} disabled={selectedRun === null || loading} className="button primary" style={{ background: battingColor }}>
                  {loading ? 'Locking...' : 'Lock Shot 🔒'}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '24px', marginBottom: '5px' }}>⏳</div>
                <div style={{ fontSize: '12px' }}>Waiting for {strikerName}...</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RECENT BALLS ── */}
      {matchData.history?.length > 0 && (
        <div className="broadcast-panel" style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>This Over</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[...matchData.history].reverse().slice(0, 6).reverse().map((h, i) => (
              <div key={i} style={{
                width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '13px',
                background: h.isWicket ? 'var(--wicket-color)' : h.runs === 6 ? 'rgba(255,215,0,0.25)' : h.runs === 4 ? 'rgba(251,140,0,0.25)' : h.runs === 0 ? 'rgba(144,164,174,0.15)' : 'rgba(165,214,167,0.2)',
                color: h.isWicket ? 'white' : h.runs === 6 ? 'var(--six-color)' : h.runs === 4 ? 'var(--four-color)' : h.runs === 0 ? 'var(--dot-color)' : 'var(--runs-color)',
                border: `1px solid ${h.isWicket ? 'var(--wicket-color)' : h.runs === 6 ? 'var(--six-color)' : h.runs === 4 ? 'var(--four-color)' : 'rgba(255,255,255,0.1)'}`,
              }}>
                {h.isWicket ? 'W' : h.runs}
              </div>
            ))}
          </div>
          {matchData.history.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              {matchData.history[matchData.history.length - 1].commentary}
            </div>
          )}
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <button onClick={leaveLobby} className="button secondary" style={{ maxWidth: '180px' }}>Leave Match</button>
      </div>
    </div>
  );
}

