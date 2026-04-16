import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const ENGINE_CONFIG = {
  TURN_TIMER_SEC: 15,
  ACCURACY_POOR_THRESHOLD: 0.2,
  ACCURACY_PERFECT_THRESHOLD: 0.8,
  FIELDER_CHANCE: 0.5,
  VERSION: '1.0.0',
  CONSECUTIVE_LIMIT: 2
};

export default function Match({ lobbyData, matchId, leaveLobby }) {
  const { currentUser } = useAuth();
  const [matchData, setMatchData] = useState(null);

  // States for player input forms
  const [deliveryType, setDeliveryType] = useState('fast');
  const [line, setLine] = useState('off');
  
  const [shotType, setShotType] = useState('drive');
  const [intent, setIntent] = useState('neutral');
  const [batsmanDirection, setBatsmanDirection] = useState('off');
  const [batsmanLoft, setBatsmanLoft] = useState('ground');

  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ENGINE_CONFIG.TURN_TIMER_SEC);
  
  const imHost = lobbyData.hostId === currentUser.uid;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (snap.exists()) setMatchData(snap.data());
    });
    return () => unsub();
  }, [matchId]);

  // TIMER LOGIC
  useEffect(() => {
    if (!matchData || matchData.status !== 'in-progress') return;
    if (matchData.ballInput?.bowler && matchData.ballInput?.batsman) return; // both completed
    
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
  }, [matchData?.ballNumber, matchData?.overNumber, matchData?.status, matchData?.ballInput]);

  function forceTimeoutActions(m) {
    const updates = {};
    if (!m.ballInput?.bowler) updates['ballInput.bowler'] = { deliveryType: 'fast', line: 'off' };
    if (!m.ballInput?.batsman) updates['ballInput.batsman'] = { shotType: 'drive', intent: 'defend', direction: 'straight', loft: 'ground' };
    if (Object.keys(updates).length > 0) updateDoc(doc(db, 'matches', matchId), updates);
  }

  // AUTO-BOT: When it's a bot's turn, the host fires the action automatically
  useEffect(() => {
    if (!matchData || !imHost || matchData.status !== 'in-progress') return;
    if (matchData.processingResult) return;
    const bIn = matchData.ballInput?.bowler;
    const batIn = matchData.ballInput?.batsman;
    if (!bIn && matchData.currentBowlerId?.startsWith('bot_')) {
      updateDoc(doc(db, 'matches', matchId), {
        'ballInput.bowler': { deliveryType: 'fast', line: 'off' }
      });
    }
    if (!batIn && matchData.strikerId?.startsWith('bot_')) {
      updateDoc(doc(db, 'matches', matchId), {
        'ballInput.batsman': { shotType: 'drive', intent: 'neutral', direction: 'off', loft: 'ground' }
      });
    }
  }, [matchData?.strikerId, matchData?.currentBowlerId, matchData?.ballInput, matchData?.status]);

  // ENGINE EXECUTION (Runs exclusively on the HOST client to prevent duplicate db execution)
  useEffect(() => {
    if (!matchData) return;
    if (imHost && matchData.status === 'in-progress') {
      const bIn = matchData.ballInput?.bowler;
      const batIn = matchData.ballInput?.batsman;
      if (bIn && batIn && !matchData.processingResult) {
        evaluateBall(matchData);
      }
    }
  }, [matchData]);

  async function evaluateBall(m) {
    // 9. Sync Control - Lock flag
    await updateDoc(doc(db, 'matches', matchId), { processingResult: true });

    const bowlerIn = m.ballInput.bowler;
    const batIn = m.ballInput.batsman;
    
    let runs = 0;
    let isWicket = false;
    let wicketType = null;
    let commentary = "";

    // 2. Accuracy System Roll
    const accRoll = Math.random();
    let accuracy = 'good';
    if (accRoll > ENGINE_CONFIG.ACCURACY_PERFECT_THRESHOLD) accuracy = 'perfect';
    else if (accRoll < ENGINE_CONFIG.ACCURACY_POOR_THRESHOLD) accuracy = 'poor';

    // 3. Shot Quality Calculation
    const lineMatch = bowlerIn.line === batIn.direction;
    let shotQuality = 'good';
    if (lineMatch && accuracy !== 'perfect') shotQuality = 'perfect';
    if (!lineMatch && accuracy === 'perfect') shotQuality = 'mistimed';
    if (accuracy === 'poor') shotQuality = 'perfect';

    // 1. Fielding Impact Simulation
    const hasFielder = Math.random() > ENGINE_CONFIG.FIELDER_CHANCE; // abstracting zones to configurable probability

    // 6. Detailed Wicket Logic & Outcome
    if (batIn.intent === 'defend') {
        if (accuracy === 'perfect' && !lineMatch && bowlerIn.deliveryType === 'yorker') {
            isWicket = true; wicketType = 'bowled';
            commentary = "Absolute peach of a yorker! Sneaks under the bat. Clean bowled!";
        } else {
            runs = 0;
            commentary = "Solidly defended, no run.";
        }
    } 
    else if (shotQuality === 'mistimed' || (accuracy === 'perfect' && batIn.intent === 'attack')) {
        if (batIn.loft === 'lofted' && hasFielder) {
            isWicket = true; wicketType = 'caught';
            commentary = `Lofted high in the air... fielder settles under it... CAUGHT!`;
        } else if (bowlerIn.deliveryType === 'fast' && !lineMatch && Math.random() > 0.5) {
            isWicket = true; wicketType = 'lbw';
            commentary = `Trapped right in front! Umpire raises the finger. Plumb LBW.`;
        } else {
            runs = batIn.loft === 'lofted' ? 2 : 1;
            commentary = "Mistimed shot. Just muscled it for a couple.";
        }
    } 
    else if (shotQuality === 'perfect' && batIn.intent === 'attack') {
        if (batIn.loft === 'lofted') {
            runs = 6;
            commentary = `Cracked! Fantastic ${batIn.shotType} over ${batIn.direction}! SIX!`;
        } else {
            runs = 4;
            commentary = `Beautiful timing on the ${batIn.shotType}! Races away to the boundary for FOUR!`;
        }
    } 
    else {
        // Neutral or good
        if (hasFielder) { runs = 1; commentary = `Played firmly into ${batIn.direction}, straight to the fielder for 1.`; }
        else { runs = 2; commentary = `Pushed into the gap for two runs.`; }
    }

    // 10. Balance Control
    if (runs === 6 && m.consecSixes >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { runs = 4; commentary = "One bounce over the rope for four instead."; }
    if (isWicket && m.consecWickets >= ENGINE_CONFIG.CONSECUTIVE_LIMIT) { isWicket = false; runs = 1; commentary = "Edged... but falls slightly short of the slip! Single taken."; }

    const consecSixes = runs === 6 ? (m.consecSixes||0) + 1 : 0;
    const consecWickets = isWicket ? (m.consecWickets||0) + 1 : 0;

    // 5. Debug / Logging Store
    const debugStats = { lineMatch, accuracy, shotQuality, hasFielder, intent: batIn.intent };
    const resultRecord = { bowler: bowlerIn, batsman: batIn, runs, isWicket, wicketType, commentary, debugStats };

    let nextScore = m.score + runs;
    let nextWickets = m.wickets + (isWicket ? 1 : 0);
    let nextBall = m.ballNumber + 1;
    let nextOver = m.overNumber;
    let overComplete = false;
    
    let swappedStrikerId = m.strikerId;
    let swappedNonStrikerId = m.nonStrikerId;

    // Odd runs swap
    if (runs % 2 !== 0 && m.nonStrikerId) {
       swappedStrikerId = m.nonStrikerId;
       swappedNonStrikerId = m.strikerId;
    }

    // Over completion
    if (nextBall === 6) {
       nextBall = 0;
       nextOver += 1;
       overComplete = true;
       if (m.nonStrikerId) {
           let temp = swappedStrikerId;
           swappedStrikerId = swappedNonStrikerId;
           swappedNonStrikerId = temp;
       }
    }

    let nextOutPlayers = [...(m.outPlayers || [])];
    if (isWicket) nextOutPlayers.push(m.strikerId);

    let matchEnded = false;
    let endOfInnings = false;

    if (m.innings === 2 && nextScore >= m.target) matchEnded = true; 
    if (nextWickets >= Math.max(1, m.teamLists[m.battingTeam].length - 1) || nextOver >= m.totalOvers) endOfInnings = true;
    if (m.innings === 2 && endOfInnings && nextScore < m.target) matchEnded = true;

    // MATCH OUTCOMES
    if (matchEnded) {
        await updateDoc(doc(db, 'matches', matchId), {
            status: m.innings === 2 && nextScore === m.target - 1 ? 'completed-tie' : 'completed',
            score: nextScore,
            wickets: nextWickets,
            history: [...(m.history||[]), resultRecord],
            ballInput: { bowler: null, batsman: null }
        });
        return;
    }

    if (endOfInnings) {
        await updateDoc(doc(db, 'matches', matchId), {
            innings: 2,
            battingTeam: m.bowlingTeam,
            bowlingTeam: m.battingTeam,
            target: nextScore + 1,
            score: 0,
            wickets: 0,
            ballNumber: 0,
            overNumber: 0,
            outPlayers: [],
            strikerId: m.teamLists[m.bowlingTeam][0],
            nonStrikerId: m.teamLists[m.bowlingTeam].length > 1 ? m.teamLists[m.bowlingTeam][1] : null,
            currentBowlerId: m.teamLists[m.battingTeam][0],
            history: [...(m.history||[]), resultRecord],
            ballInput: { bowler: null, batsman: null }
        });
        return;
    }

    let nextStriker = swappedStrikerId;
    if (isWicket) {
        const availableBatsmen = m.teamLists[m.battingTeam].filter(id => !nextOutPlayers.includes(id) && id !== swappedNonStrikerId);
        nextStriker = availableBatsmen.length > 0 ? availableBatsmen[0] : null;
    }

    // 4. Over Transition Check
    if (overComplete && !endOfInnings && !matchEnded) {
        await updateDoc(doc(db, 'matches', matchId), {
            status: 'over-break', // 4. Over Transition Phase
            score: nextScore,
            wickets: nextWickets,
            ballNumber: 0,
            overNumber: nextOver,
            strikerId: nextStriker,
            nonStrikerId: swappedNonStrikerId,
            outPlayers: nextOutPlayers,
            lastOverBowlerId: m.currentBowlerId, // store so they can't bowl again immediately
            history: [...(m.history||[]), resultRecord],
            ballInput: { bowler: null, batsman: null },
            consecSixes,
            consecWickets,
            processingResult: false // unlock
        });
        return;
    }

    await updateDoc(doc(db, 'matches', matchId), {
        score: nextScore,
        wickets: nextWickets,
        ballNumber: nextBall,
        overNumber: nextOver,
        strikerId: nextStriker,
        nonStrikerId: swappedNonStrikerId,
        currentBowlerId: m.currentBowlerId,
        lastOverBowlerId: m.lastOverBowlerId || null,
        outPlayers: nextOutPlayers,
        history: [...(m.history||[]), resultRecord],
        ballInput: { bowler: null, batsman: null },
        consecSixes,
        consecWickets,
        processingResult: false // unlock
    });
  }

  async function submitBowlingAction(e) {
    if (e) e.preventDefault();
    // 3. Anti-Cheat Security Hook
    if (matchData.currentBowlerId !== currentUser.uid) return alert("Anti-cheat: You are not authorized as the active bowler.");
    
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), {
        'ballInput.bowler': { deliveryType, line, submittedBy: currentUser.uid }
    });
    setLoading(false);
  }

  async function submitBattingAction(e) {
    if (e) e.preventDefault();
    // 3. Anti-Cheat Security Hook
    if (matchData.strikerId !== currentUser.uid) return alert("Anti-cheat: You are not authorized as the active striker.");
    
    setLoading(true);
    await updateDoc(doc(db, 'matches', matchId), {
        'ballInput.batsman': { shotType, intent, direction: batsmanDirection, loft: batsmanLoft, submittedBy: currentUser.uid }
    });
    setLoading(false);
  }

  async function submitNextBowler(uid) {
    await updateDoc(doc(db, 'matches', matchId), {
       status: 'in-progress',
       currentBowlerId: uid
    });
  }

  // OVER-BREAK TIMEOUT: prevent soft-lock if bowling captain is AFK
  useEffect(() => {
    if (!matchData || matchData.status !== 'over-break' || !imHost) return;
    const timer = setTimeout(() => {
      // Auto-select any eligible bowler, preferring humans then bots
      const bowlingTeamRoster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
      const eligible = bowlingTeamRoster.filter(p => p.uid !== matchData.lastOverBowlerId);
      const pick = eligible.find(p => !p.isBot) || eligible[0];
      if (pick) {
        updateDoc(doc(db, 'matches', matchId), { status: 'in-progress', currentBowlerId: pick.uid });
      }
    }, ENGINE_CONFIG.TURN_TIMER_SEC * 1000);
    return () => clearTimeout(timer);
  }, [matchData?.status, matchData?.overNumber]);

  if (!matchData) return <div className="container center" style={{color:'white'}}>Loading Match State...</div>;

  const isMyTurnToBowl = matchData.currentBowlerId === currentUser.uid;
  const isMyTurnToBat = matchData.strikerId === currentUser.uid;
  
  // Roles for Break screens
  const amBowlingCaptain = Object.values(lobbyData.players).find(p => p.uid === currentUser.uid && p.team === matchData.bowlingTeam && p.isCaptain);

  // 7. Match Summary Screen
  if (matchData.status === 'completed' || matchData.status === 'completed-tie') {
    const isTie = matchData.status === 'completed-tie';
    return (
      <div className="container center text-center" style={{color:'white', flexDirection:'column', gap: '20px', maxWidth: '600px'}}>
        <h1 style={{color: 'gold'}}>{isTie ? "Match Tied!" : "Match Completed!"}</h1>
        <div style={{background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', width: '100%'}}>
            <h2>Target: {matchData.target}</h2>
            <h1 style={{color: 'var(--primary-color)'}}>Final Score: {matchData.score} / {matchData.wickets}</h1>
            <p>Overs Bowled: {matchData.overNumber}.{matchData.ballNumber}</p>
        </div>
        
        <div style={{background: 'var(--card-bg)', padding: '20px', borderRadius: '8px', width: '100%', maxHeight: '300px', overflowY: 'auto', textAlign:'left'}}>
           <h3>Ball-by-Ball Summary</h3>
           {(matchData.history || []).map((h, i) => (
             <div key={i} style={{padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.1)'}}>
                 <span style={{color:'var(--primary-color)'}}>[Ball {i+1}]</span> {h.commentary}
             </div>
           ))}
        </div>

        <button onClick={leaveLobby} className="button secondary">Leave Match</button>
      </div>
    );
  }

  // 4. Over Transition Screen
  if (matchData.status === 'over-break') {
      const bowlingTeamRoster = Object.values(lobbyData.players).filter(p => p.team === matchData.bowlingTeam);
      const eligibleBowlers = bowlingTeamRoster.filter(p => p.uid !== matchData.lastOverBowlerId);
      
      return (
        <div className="container center text-center" style={{color:'white', flexDirection:'column', gap: '20px'}}>
          <h2>Over Completed!</h2>
          <p>Score: {matchData.score} / {matchData.wickets}</p>
          <div style={{background: 'var(--card-bg)', padding: '20px', borderRadius: '8px'}}>
             <h3>Select Next Bowler</h3>
             {amBowlingCaptain || imHost ? (
               <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                 {eligibleBowlers.map(p => (
                   <button key={p.uid} onClick={() => submitNextBowler(p.uid)} className="button primary">{p.name}</button>
                 ))}
                 {eligibleBowlers.length === 0 && <button onClick={() => submitNextBowler('bot_auto')} className="button primary">Auto Bowler</button>}
               </div>
             ) : (
               <p>Waiting for bowling captain to select the next bowler...</p>
             )}
          </div>
        </div>
      );
  }

  return (
    <div className="container" style={{color:'white', flexDirection:'column', gap:'20px', maxWidth: '800px', margin: '0 auto'}}>
      
      {/* Scoreboard & Timer */}
      <div style={{background:'var(--card-bg)', padding:'20px', borderRadius:'8px', textAlign:'center', position: 'relative'}}>
        <h2>Innings {matchData.innings} | Over {matchData.overNumber}.{matchData.ballNumber} / {matchData.totalOvers}</h2>
        <h1 style={{color:'var(--primary-color)'}}>{matchData.score} - {matchData.wickets}</h1>
        {matchData.target && <p>Target: {matchData.target}</p>}
        {matchData.processingResult && <p style={{color:'yellow'}}>Evaluating logic...</p>}
        
        {/* Timer Bar */}
        <div style={{position: 'absolute', top: '10px', right: '20px', background: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '8px'}}>
           <h3 style={{color: timeLeft < 5 ? 'var(--error-color)' : 'white'}}>⏱ {timeLeft}s</h3>
        </div>
      </div>

      <div style={{display:'flex', gap:'20px'}}>
         {/* Bowler Controls */}
         <div style={{flex:1, background:'var(--card-bg)', padding:'15px', borderRadius:'8px'}}>
            <h3>Bowling Team</h3>
            <p>Active Bowler ID: {matchData.currentBowlerId}</p>
            {matchData.ballInput?.bowler ? (
               <p style={{color:'var(--success-color)'}}>Delivery Locked In!</p>
            ) : isMyTurnToBowl ? (
               <form onSubmit={submitBowlingAction} style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                  <select value={deliveryType} onChange={e=>setDeliveryType(e.target.value)} className="input">
                     <option value="fast">Fast</option>
                     <option value="spin">Spin</option>
                     <option value="yorker">Yorker</option>
                     <option value="bouncer">Bouncer</option>
                  </select>
                  <select value={line} onChange={e=>setLine(e.target.value)} className="input">
                     <option value="off">Off</option>
                     <option value="middle">Middle</option>
                     <option value="leg">Leg</option>
                  </select>
                  <button disabled={loading} type="submit" className="button primary">{loading ? "Submitting..." : "Submit Delivery"}</button>
               </form>
            ) : (
               <p>Waiting for current bowler...</p>
            )}
         </div>

         {/* Batsman Controls */}
         <div style={{flex:1, background:'var(--card-bg)', padding:'15px', borderRadius:'8px'}}>
            <h3>Batting Team</h3>
            <p>On Strike ID: {matchData.strikerId}</p>
            {matchData.ballInput?.batsman ? (
               <p style={{color:'var(--success-color)'}}>Shot Locked In!</p>
            ) : isMyTurnToBat ? (
               <form onSubmit={submitBattingAction} style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                  <select value={shotType} onChange={e=>setShotType(e.target.value)} className="input">
                     <option value="drive">Drive</option>
                     <option value="pull">Pull</option>
                     <option value="cut">Cut</option>
                  </select>
                  <select value={intent} onChange={e=>setIntent(e.target.value)} className="input">
                     <option value="attack">Attack</option>
                     <option value="neutral">Neutral</option>
                     <option value="defend">Defend</option>
                  </select>
                  <select value={batsmanDirection} onChange={e=>setBatsmanDirection(e.target.value)} className="input">
                     <option value="off">Off Side</option>
                     <option value="straight">Straight</option>
                     <option value="leg">Leg Side</option>
                  </select>
                  <select value={batsmanLoft} onChange={e=>setBatsmanLoft(e.target.value)} className="input">
                     <option value="ground">Along the Ground</option>
                     <option value="lofted">Lofted</option>
                  </select>
                  <button disabled={loading} type="submit" className="button primary">{loading ? "Submitting..." : "Submit Shot"}</button>
               </form>
            ) : (
               <p>Waiting for batsman on strike...</p>
            )}
         </div>
      </div>

      {/* Realtime Commentary Store */}
      <div style={{background:'var(--card-bg)', padding:'15px', borderRadius:'8px', marginTop:'20px'}}>
         <h3 style={{borderBottom:'1px solid gray', paddingBottom:'10px', marginBottom:'10px'}}>Last Delivery</h3>
         {matchData.history && matchData.history.length > 0 ? (
            <div style={{fontSize:'16px'}}>
                <span style={{color:'var(--primary-color)', fontWeight:'bold'}}>
                   [{matchData.overNumber}.{matchData.ballNumber === 0 ? 6 : matchData.ballNumber}] 
                </span>
                {' '}
                {matchData.history[matchData.history.length-1].commentary}
            </div>
         ) : <p>No deliveries bowled yet.</p>}
      </div>

      <div style={{textAlign:'center'}}>
        <button onClick={leaveLobby} className="button secondary" style={{maxWidth:'200px'}}>Leave Engine Viewer</button>
      </div>

    </div>
  );
}
