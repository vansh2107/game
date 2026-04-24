import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const ENGINE_CONFIG = {
  TURN_TIMER_SEC: 30,
  ACCURACY_POOR_THRESHOLD: 0.2,
  ACCURACY_PERFECT_THRESHOLD: 0.8,
  VERSION: '1.0.0',
  CONSECUTIVE_LIMIT: 2,
  TOTAL_FIELDERS: 10,
};

const ZONES = ['off', 'straight', 'leg', 'deep-off', 'deep-leg'];
const DEFAULT_FIELD = { off: 3, straight: 3, leg: 2, 'deep-off': 1, 'deep-leg': 1 };

const SHOT_VISUALS = {
  'drive': { icon: '🏏', bgColor: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', label: 'Classic Drive' },
  'cover drive': { icon: '✨🏏', bgColor: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', label: 'Elegant Cover Drive' },
  'straight drive': { icon: '🎯🏏', bgColor: 'linear-gradient(135deg, #2980b9 0%, #6dd5fa 100%)', label: 'Straight Drive' },
  'pull': { icon: '🌪️🏏', bgColor: 'linear-gradient(135deg, #cb2d3e 0%, #ef473a 100%)', label: 'Aggressive Pull' },
  'cut': { icon: '⚔️🏏', bgColor: 'linear-gradient(135deg, #ff9966 0%, #ff5e62 100%)', label: 'Late Cut' },
  'sweep': { icon: '🧹🏏', bgColor: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)', label: 'Sweep Shot' },
  'scoop': { icon: '🥄🏏', bgColor: 'linear-gradient(135deg, #8A2387 0%, #E94057 100%)', label: 'Ramp / Scoop' },
  'helicopter shot': { icon: '🚁🏏', bgColor: 'linear-gradient(135deg, #00C9FF 0%, #92FE9D 100%)', label: 'Helicopter Shot' },
};

const BOWLING_VISUALS = {
  'fast': { icon: '🔥🥎', bgColor: 'linear-gradient(135deg, #FF416C 0%, #FF4B2B 100%)', label: 'Pace Delivery' },
  'spin': { icon: '🌀🥎', bgColor: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)', label: 'Spin Delivery' },
  'yorker': { icon: '🎯🥎', bgColor: 'linear-gradient(135deg, #FDC830 0%, #F37335 100%)', label: 'Toe-Crushing Yorker' },
  'bouncer': { icon: '🚀🥎', bgColor: 'linear-gradient(135deg, #141E30 0%, #243B55 100%)', label: 'Aggressive Bouncer' },
};

function ActionCinematicPanel({ type, choiceObj, isSubmitted }) {
  if (!choiceObj) return null;
  let data;
  if (type === 'batting') {
    const visual = SHOT_VISUALS[choiceObj.shotType] || SHOT_VISUALS['drive'];
    data = {
      title: isSubmitted ? 'Shot Locked In!' : 'Shot Selection Preview',
      icon: visual.icon,
      bg: visual.bgColor,
      mainText: visual.label,
      subText: `Intent: ${choiceObj.intent.toUpperCase()} | Direction: ${choiceObj.direction.toUpperCase()} | Loft: ${choiceObj.loft.toUpperCase()}`
    };
  } else {
    const visual = BOWLING_VISUALS[choiceObj.deliveryType] || BOWLING_VISUALS['fast'];
    data = {
      title: isSubmitted ? 'Delivery Locked In!' : 'Delivery Selection Preview',
      icon: visual.icon,
      bg: visual.bgColor,
      mainText: visual.label,
      subText: `Line: ${choiceObj.line.toUpperCase()}`
    };
  }

  return (
    <div style={{
      width: '100%',
      padding: '20px',
      borderRadius: '12px',
      background: data.bg,
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      position: 'relative',
      overflow: 'hidden',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ fontSize: '54px', zIndex: 2, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>{data.icon}</div>
      <div style={{ zIndex: 2, textAlign: 'left' }}>
        <p style={{ margin: '0 0 5px 0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '2px', opacity: 0.8 }}>{data.title}</p>
        <h2 style={{ margin: '0 0 10px 0', fontSize: '24px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{data.mainText}</h2>
        <p style={{ margin: 0, fontSize: '13px', background: 'rgba(0,0,0,0.3)', padding: '5px 10px', borderRadius: '4px', display: 'inline-block' }}>{data.subText}</p>
      </div>
      <div style={{
         position: 'absolute', top: '-10%', right: '-4%', fontSize: '140px', opacity: 0.1, zIndex: 1, transform: 'rotate(-15deg)', pointerEvents: 'none'
      }}>
        {data.icon.replace(/[^🥎🏏]/g, '') || data.icon.substring(0, 2)}
      </div>
    </div>
  );
}

// Random bot action generators
function randomBowlingAction() {
  const deliveryTypes = ['fast', 'spin', 'yorker', 'bouncer'];
  const lines = ['off', 'middle', 'leg'];
  return {
    deliveryType: deliveryTypes[Math.floor(Math.random() * deliveryTypes.length)],
    line: lines[Math.floor(Math.random() * lines.length)]
  };
}

function randomBattingAction() {
  const shotTypes = ['drive', 'cover drive', 'straight drive', 'pull', 'cut', 'sweep', 'scoop', 'helicopter shot'];
  const intents = ['attack', 'neutral', 'defend'];
  const directions = ['off', 'straight', 'leg'];
  const lofts = ['ground', 'lofted'];
  return {
    shotType: shotTypes[Math.floor(Math.random() * shotTypes.length)],
    intent: intents[Math.floor(Math.random() * intents.length)],
    direction: directions[Math.floor(Math.random() * directions.length)],
    loft: lofts[Math.floor(Math.random() * lofts.length)]
  };
}

function randomFieldSettings() {
  // Generate varied field placements — not always the same
  const presets = [
    { off: 3, straight: 3, leg: 2, 'deep-off': 1, 'deep-leg': 1 }, // balanced
    { off: 4, straight: 2, leg: 2, 'deep-off': 1, 'deep-leg': 1 }, // off-heavy
    { off: 2, straight: 2, leg: 4, 'deep-off': 1, 'deep-leg': 1 }, // leg-heavy
    { off: 2, straight: 4, leg: 2, 'deep-off': 1, 'deep-leg': 1 }, // straight-heavy
    { off: 2, straight: 2, leg: 2, 'deep-off': 2, 'deep-leg': 2 }, // deep-heavy
  ];
  return presets[Math.floor(Math.random() * presets.length)];
}


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
  const commentaryVoiceRef = useRef(0);

  const imHost = lobbyData.hostId === currentUser.uid;

  // VOICE COMMENTARY HOOK
  useEffect(() => {
    if (!matchData || !matchData.history) return;
    const currentLen = matchData.history.length;
    
    // Only speak if length has strictly increased, and we are not on the initial mount load 
    // (meaning someone actually played a new ball during this session)
    if (currentLen > commentaryVoiceRef.current) {
      if (commentaryVoiceRef.current !== 0) {
        const latestCommentary = matchData.history[currentLen - 1]?.commentary;
        if (latestCommentary && window.speechSynthesis) {
           // Cancel any ongoing speech to keep it snappy and relevant
           window.speechSynthesis.cancel();

           const utterance = new SpeechSynthesisUtterance(latestCommentary);
           utterance.rate = 1.0;
           utterance.pitch = 1.1; // Make it sound slightly more energetic
           
           // Attempt to find an English voice
           const voices = window.speechSynthesis.getVoices();
           const enVoice = voices.find(v => v.name.includes('Google') || v.lang.includes('en-GB') || v.lang.includes('en-US'));
           if (enVoice) utterance.voice = enVoice;

           window.speechSynthesis.speak(utterance);
        }
      }
      commentaryVoiceRef.current = currentLen;
    }
  }, [matchData?.history]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'matches', matchId), snap => {
      if (snap.exists()) setMatchData(snap.data());
    });
    return () => unsub();
  }, [matchId]);

  // TIMER — resets on new ball AND when field is set, giving full time for shots
  useEffect(() => {
    if (!matchData || matchData.status !== 'in-progress') return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) return;

    const fieldStep = matchData.fieldSettings ? 'field-set' : 'field-unset';
    const ballKey = `${matchData.innings}-${matchData.overNumber}-${matchData.ballNumber}-${fieldStep}`;
    
    if (timerBallRef.current === ballKey) return; // same state, don't reset
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
  }, [matchData?.innings, matchData?.overNumber, matchData?.ballNumber, matchData?.status, matchData?.fieldSettings]);

  function forceTimeoutActions(m) {
    const updates = {};
    if (!m.fieldSettings) {
        // If field hasn't been set in time, auto-set so turn timer resets
        updates.fieldSettings = randomFieldSettings();
    } else {
        // If field is set, default to random shots
        if (!m.ballInput?.bowler) updates['ballInput.bowler'] = randomBowlingAction();
        if (!m.ballInput?.batsman) updates['ballInput.batsman'] = randomBattingAction();
    }
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
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.bowler': randomBowlingAction() });
      }
      if (!batIn && matchData.strikerId?.startsWith('bot_')) {
        updateDoc(doc(db, 'matches', matchId), { 'ballInput.batsman': randomBattingAction() });
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

    const hasFielder = checkFielder(m.fieldSettings, batIn.direction, batIn.loft);
    const lineMatch = bowlerIn.line === batIn.direction;

    // Decision Engine Factors
    const isCrossBatted = 
      (bowlerIn.line === 'off' && batIn.direction === 'leg') || 
      (bowlerIn.line === 'leg' && batIn.direction === 'off');
      
    const isShotMismatched = 
      (batIn.shotType === 'pull' && bowlerIn.deliveryType !== 'bouncer' && bowlerIn.line === 'off') ||
      (['drive', 'cover drive', 'straight drive'].includes(batIn.shotType) && bowlerIn.deliveryType === 'bouncer') ||
      (batIn.shotType === 'cover drive' && bowlerIn.line !== 'off') ||
      (batIn.shotType === 'straight drive' && bowlerIn.line !== 'middle') ||
      (batIn.shotType === 'cut' && bowlerIn.line !== 'off') ||
      (batIn.shotType === 'helicopter shot' && (bowlerIn.deliveryType === 'bouncer' || bowlerIn.deliveryType === 'spin')) ||
      (batIn.shotType === 'sweep' && (bowlerIn.deliveryType === 'fast' || bowlerIn.deliveryType === 'bouncer' || bowlerIn.deliveryType === 'yorker')) ||
      (batIn.shotType === 'scoop' && (bowlerIn.deliveryType === 'spin' || bowlerIn.deliveryType === 'yorker'));

    // Base probabilities for wickets
    let edgeProb = 0.01;
    let lbwProb = 0.01;
    let bowledProb = 0.01;
    let caughtProb = 0.01;
    let runOutProb = hasFielder ? 0.03 : 0.01;

    // Modifiers based on delivery and shot
    if (accuracy === 'perfect') {
      edgeProb += 0.08;
      bowledProb += 0.06;
      lbwProb += 0.06;
    }

    if (isCrossBatted) {
      edgeProb += 0.10;
      lbwProb += 0.08;
      bowledProb += 0.06;
    }

    if (isShotMismatched) {
      edgeProb += 0.08;
      caughtProb += 0.12;
    }

    if (batIn.intent === 'defend') {
      edgeProb *= 0.3;
      caughtProb *= 0; 
      if (accuracy === 'perfect' && bowlerIn.deliveryType === 'yorker') {
        bowledProb += 0.15;
        lbwProb += 0.08;
      }
    } else if (batIn.intent === 'attack') {
      edgeProb += 0.05;
      bowledProb += 0.05;
      if (bowlerIn.deliveryType === 'spin' && !lineMatch) {
         caughtProb += 0.08;
      }
    }

    if (accuracy === 'poor') {
      edgeProb = 0;
      bowledProb = 0;
      lbwProb = 0;
    }

    const randWicket = Math.random();

    if (randWicket < bowledProb) {
       isWicket = true; wicketType = 'bowled'; commentary = 'Beaten by the pace and movement... Clean bowled!';
    } else if (randWicket < bowledProb + lbwProb) {
       isWicket = true; wicketType = 'lbw'; commentary = 'Struck on the pads right in front! Plumb LBW.';
    } else if (randWicket < bowledProb + lbwProb + edgeProb) {
       isWicket = true; wicketType = 'caught'; commentary = 'Finds the outside edge... safely taken by the keeper!';
    } else if (batIn.loft === 'lofted' && hasFielder && Math.random() < 0.25 + caughtProb) {
       isWicket = true; wicketType = 'caught'; commentary = 'Lofted straight down the throat of the fielder! CAUGHT!';
    }

    let shotQuality = 'good';
    if (!isWicket) {
      if (batIn.intent === 'defend') {
        runs = 0; commentary = 'Solidly defended, no run.';
        shotQuality = 'defended';
      } else {
        const excellentConnection = (accuracy === 'poor') || (!isCrossBatted && !isShotMismatched && accuracy !== 'perfect');
        
        if (excellentConnection) {
          shotQuality = 'perfect';
          let shotNameDisplay = batIn.shotType.replace(/\b\w/g, l => l.toUpperCase());
          if (batIn.loft === 'lofted') {
             runs = hasFielder ? 2 : 6;
             commentary = runs === 6 ? `Cracked! Fantastic ${shotNameDisplay} over ${batIn.direction}! SIX!` : `Lofted ${shotNameDisplay} into the deep, cuts it off for 2.`;
          } else {
             runs = hasFielder ? 1 : 4;
             commentary = runs === 4 ? `Beautiful ${shotNameDisplay}! Pierces the gap for FOUR!` : `Played safely to the fielder, single taken.`;
          }
        } else {
          shotQuality = 'mistimed';
          if (batIn.loft === 'lofted') {
             runs = 1; commentary = `Mistimed overhead. Fails to clear the infield properly, just a single.`;
          } else {
             runs = hasFielder ? 0 : 1; 
             commentary = runs === 0 ? `Misplayed straight to the fielder. No run.` : `Scratches around for a single.`;
          }
        }

        if (runs >= 0 && Math.random() < runOutProb && batIn.intent !== 'defend') {
           isWicket = true; wicketType = 'run out'; runs = 0; commentary = 'Mix up in the middle... direct hit! RUN OUT!';
        }
      }
    } else {
        shotQuality = 'missed/edged';
    }

    // Balance control
    if (runs === 6 && (m.consecSixes || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { runs = 4; commentary = 'One bounce over the rope for four.'; }
    if (isWicket && (m.consecWickets || 0) >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { 
      isWicket = false; 
      runs = wicketType === 'run out' ? 0 : 1; 
      commentary = wicketType === 'run out' ? 'Direct hit! But wait, umpire says NOT OUT!' : 'Edged... falls short of slip! Single taken.'; 
      wicketType = null;
    }

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
    const maxWickets = m.lastManStand ? m.teamLists[m.battingTeam].length : Math.max(1, m.teamLists[m.battingTeam].length - 1);
    const endOfInnings = nextWickets >= maxWickets || nextOver >= m.totalOvers;

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
        status: 'setup', setupReason: 'innings-break',
        innings: 2,
        battingTeam: m.bowlingTeam, bowlingTeam: m.battingTeam,
        target: nextScore + 1,
        score: 0, wickets: 0, ballNumber: 0, overNumber: 0, outPlayers: [],
        strikerId: null, nonStrikerId: null, currentBowlerId: null,
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        fieldSettings: null, consecSixes: 0, consecWickets: 0,
        processingResult: false
      });
      return;
    }

    let nextStriker = swappedStriker;
    if (isWicket) {
      nextStriker = null; // Forces batting captain to manually assign next batsman
    }

    if (overComplete) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'setup', setupReason: isWicket ? 'over-complete-wicket' : 'over-break',
        score: nextScore, wickets: nextWickets, ballNumber: 0, overNumber: nextOver,
        strikerId: nextStriker, nonStrikerId: swappedNonStriker,
        outPlayers: nextOutPlayers, lastOverBowlerId: m.currentBowlerId,
        currentBowlerId: null, // Forces bowling captain to pick next bowler
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        fieldSettings: null, consecSixes, consecWickets,
        processingResult: false
      });
      return;
    }

    if (isWicket) {
      await updateDoc(doc(db, 'matches', matchId), {
        status: 'setup', setupReason: 'wicket-fallen',
        score: nextScore, wickets: nextWickets, ballNumber: nextBall, overNumber: nextOver,
        strikerId: null, nonStrikerId: swappedNonStriker,
        outPlayers: nextOutPlayers, lastOverBowlerId: m.lastOverBowlerId || null,
        currentBowlerId: m.currentBowlerId,
        history: [...(m.history || []), resultRecord],
        ballInput: { bowler: null, batsman: null },
        consecSixes, consecWickets, processingResult: false
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
    // Only the bowling captain sets the field
    if (!amBowlingCaptain) return;
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
    await updateDoc(doc(db, 'matches', matchId), {
      status: 'setup', setupReason: 'innings-break',
      tossChoice: choice,
      innings: 1,
      battingTeam: batFirst, bowlingTeam: bowlFirst,
      score: 0, wickets: 0, target: null, ballNumber: 0, overNumber: 0,
      strikerId: null,
      nonStrikerId: null,
      currentBowlerId: null,
      outPlayers: [],
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

  // FIX: auto-set field for bot captain
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress') return;
    if (matchData.fieldSettings) return;
    
    const bowlCap = Object.values(lobbyData.players).find(p => p.team === matchData.bowlingTeam && p.isCaptain);
    
    // Auto-set if the bowling captain is a bot
    if (bowlCap?.isBot) {
      updateDoc(doc(db, 'matches', matchId), { fieldSettings: randomFieldSettings() });
    }
  }, [matchData?.status, matchData?.ballNumber, matchData?.overNumber, matchData?.innings, matchData?.fieldSettings, matchData?.bowlingTeam]);

  // Setup completion transition
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'setup') return;
    const teamSize = matchData.teamLists[matchData.battingTeam].length;
    const outCount = matchData.outPlayers?.length || 0;
    const lastManStanding = matchData.lastManStand && (teamSize - outCount <= 1);
    const needsNonStriker = (teamSize > 1 && !matchData.nonStrikerId && !lastManStanding);
    if (matchData.currentBowlerId && matchData.strikerId && !needsNonStriker) {
       updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', setupReason: null });
    }
  }, [matchData]);

  // SETUP TIMEOUT and AUTO-BOT logic — prevents soft-lock if captains are AFK or bots
  useEffect(() => {
    if (!matchData || matchData.status !== 'setup' || !imHost) return;

    const bowlCap = Object.values(lobbyData.players).find(p => p.team === matchData.bowlingTeam && p.isCaptain);
    const batCap = Object.values(lobbyData.players).find(p => p.team === matchData.battingTeam && p.isCaptain);

    let bowlTimer = null;
    let batTimer = null;

    if (!matchData.currentBowlerId) {
      const delay = bowlCap?.isBot ? 1000 : ENGINE_CONFIG.TURN_TIMER_SEC * 1000;
      bowlTimer = setTimeout(() => {
        const roBowl = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
        const eligibleB = roBowl.filter(p => p.uid !== matchData.lastOverBowlerId);
        const picked = (eligibleB.length > 0 ? eligibleB : roBowl)[0]?.uid || matchData.teamLists[matchData.bowlingTeam][0];
        updateDoc(doc(db, 'matches', matchId), { currentBowlerId: picked });
      }, delay);
    }

    const needsBatsman = !matchData.strikerId || (!matchData.nonStrikerId && matchData.teamLists[matchData.battingTeam].length > 1);
    if (needsBatsman) {
      const delay = batCap?.isBot ? 1000 : ENGINE_CONFIG.TURN_TIMER_SEC * 1000;
      batTimer = setTimeout(() => {
        const updates = {};
        if (!matchData.strikerId) {
          const avail = matchData.teamLists[matchData.battingTeam].filter(id => !matchData.outPlayers?.includes(id) && id !== matchData.nonStrikerId);
          if (avail.length > 0) updates.strikerId = avail[0];
        }
        if (!matchData.nonStrikerId && matchData.teamLists[matchData.battingTeam].length > 1) {
          const avail = matchData.teamLists[matchData.battingTeam].filter(id => !matchData.outPlayers?.includes(id) && id !== matchData.strikerId && id !== updates.strikerId);
          if (avail.length > 0) updates.nonStrikerId = avail[0];
        }
        if (Object.keys(updates).length > 0) updateDoc(doc(db, 'matches', matchId), updates);
      }, delay);
    }

    return () => {
      if (bowlTimer) clearTimeout(bowlTimer);
      if (batTimer) clearTimeout(batTimer);
    };
  }, [matchData?.status, matchData?.strikerId, matchData?.nonStrikerId, matchData?.currentBowlerId]);

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
        const maxWicketsWin = matchData.lastManStand ? matchData.teamLists[winningTeam].length : Math.max(1, matchData.teamLists[winningTeam].length - 1);
        const wicketsLeft = maxWicketsWin - matchData.wickets;
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

  // ── SETUP (Innings Break, Wicket, Over Break) ─────────────────────────────────
  if (matchData.status === 'setup') {
    const batRoster = Object.values(lobbyData.players).filter(p => p.team === matchData.battingTeam);
    const bowlRoster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
    
    const eligibleBowlers = bowlRoster.filter(p => p.uid !== matchData.lastOverBowlerId);
    const bowlPool = eligibleBowlers.length > 0 ? eligibleBowlers : bowlRoster;

    const availBatsmen = batRoster.filter(p => !matchData.outPlayers?.includes(p.uid));

    const amBattingCaptain = !!batRoster.find(p => p.uid === currentUser.uid && p.isCaptain);
    const amBowlingCaptain = !!bowlRoster.find(p => p.uid === currentUser.uid && p.isCaptain);

    let title = "Match Setup";
    if (matchData.setupReason === 'innings-break') title = `Innings ${matchData.innings} Start`;
    if (matchData.setupReason === 'wicket-fallen') title = "Wicket Fallen!";
    if (matchData.setupReason === 'over-break') title = "Over Complete!";
    if (matchData.setupReason === 'over-complete-wicket') title = "Over Complete & Wicket!";

    async function pickStriker(uid) { await updateDoc(doc(db, 'matches', matchId), { strikerId: uid }); }
    async function pickNonStriker(uid) { await updateDoc(doc(db, 'matches', matchId), { nonStrikerId: uid }); }
    async function pickBowler(uid) { await updateDoc(doc(db, 'matches', matchId), { currentBowlerId: uid }); }

    return (
      <div className="container center text-center" style={{ color: 'white', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
        <h2>{title}</h2>
        <p>Score: {matchData.score} / {matchData.wickets}</p>
        
        <div className="flex-row-responsive" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          
          {/* Bowling Selection */}
          {!matchData.currentBowlerId && (
             <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', flex: '1 1 300px' }}>
               <h3 style={{ color: 'var(--primary-color)' }}>Select Bowler</h3>
               {amBowlingCaptain ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                   {bowlPool.map(p => (
                     <div key={p.uid} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                       <span style={{flex: 1}}>{p.name}</span>
                       <button onClick={() => pickBowler(p.uid)} className="button primary" style={{padding: '5px 10px'}}>Select</button>
                     </div>
                   ))}
                 </div>
               ) : (
                 <p style={{ color: 'orange' }}>Waiting for bowling captain...</p>
               )}
             </div>
          )}

          {/* Batting Selection (New Striker/Openers) */}
          {(!matchData.strikerId || (!matchData.nonStrikerId && matchData.teamLists[matchData.battingTeam].length > 1 && !(matchData.lastManStand && matchData.teamLists[matchData.battingTeam].length - (matchData.outPlayers?.length || 0) <= 1))) && (
             <div style={{ background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', flex: '1 1 300px' }}>
               <h3 style={{ color: 'gold' }}>Select Batsmen</h3>
               {amBattingCaptain ? (
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                   {!matchData.strikerId && <p style={{ margin: '5px 0' }}>Pick Striker:</p>}
                   {!matchData.strikerId && availBatsmen.filter(p => p.uid !== matchData.nonStrikerId).map(p => (
                     <button key={p.uid} onClick={() => pickStriker(p.uid)} className="button primary">{p.name}</button>
                   ))}
                   {matchData.strikerId && !matchData.nonStrikerId && matchData.teamLists[matchData.battingTeam].length > 1 && !(matchData.lastManStand && matchData.teamLists[matchData.battingTeam].length - (matchData.outPlayers?.length || 0) <= 1) && (
                      <>
                        <p style={{ margin: '5px 0' }}>Pick Non-Striker:</p>
                        {availBatsmen.filter(p => p.uid !== matchData.strikerId).map(p => (
                          <button key={p.uid} onClick={() => pickNonStriker(p.uid)} className="button primary">{p.name}</button>
                        ))}
                      </>
                   )}
                 </div>
               ) : (
                 <p style={{ color: 'orange' }}>Waiting for batting captain...</p>
               )}
             </div>
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

      {/* Field Placement — only captain can set */}
      {!fieldIsSet && amBowlingCaptain && (
        <FieldSetter key="field-setter" current={null} onSave={saveFieldSettings} />
      )}
      {!fieldIsSet && !amBowlingCaptain && (
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
          {amBowlingCaptain && (
            <button
              onClick={() => updateDoc(doc(db, 'matches', matchId), { fieldSettings: null })}
              style={{ marginLeft: 'auto', fontSize: '12px', padding: '3px 10px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
            >
              Reset Field
            </button>
          )}
        </div>
      )}

      <div className="flex-row-responsive">
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
                <option value="cover drive">Cover Drive</option>
                <option value="straight drive">Straight Drive</option>
                <option value="pull">Pull</option>
                <option value="cut">Cut</option>
                <option value="sweep">Sweep</option>
                <option value="scoop">Scoop / Ramp</option>
                <option value="helicopter shot">Helicopter Shot</option>
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

      {/* Cinematic Preview Panel */}
      {(isMyTurnToBat || isMyTurnToBowl) && fieldIsSet && !matchData.processingResult && (
        <ActionCinematicPanel 
          type={isMyTurnToBat ? 'batting' : 'bowling'}
          choiceObj={
            isMyTurnToBat 
              ? (matchData.ballInput?.batsman || { shotType, intent, direction: batsmanDirection, loft: batsmanLoft })
              : (matchData.ballInput?.bowler || { deliveryType, line })
          }
          isSubmitted={isMyTurnToBat ? !!matchData.ballInput?.batsman : !!matchData.ballInput?.bowler}
        />
      )}

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
