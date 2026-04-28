import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField, arrayUnion } from 'firebase/firestore';
import Match, { ENGINE_CONFIG } from '../components/Match';

export default function Multiplayer() {
  const { currentUser } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [lobbyData, setLobbyData] = useState(null);
  const [lobbyId, setLobbyId] = useState(localStorage.getItem('currentLobby') || null);

  const userName = currentUser?.email?.split('@')[0] || 'Player';

  useEffect(() => {
    if (!lobbyId) return;
    const unsub = onSnapshot(doc(db, 'lobbies', lobbyId), (docSnap) => {
      if (docSnap.exists()) {
        setLobbyData(docSnap.data());
      } else {
        setLobbyData(null);
        setLobbyId(null);
        localStorage.removeItem('currentLobby');
      }
    });
    return () => unsub();
  }, [lobbyId]);

  async function createLobby() {
    try {
      setError('');
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const newLobby = {
        lobbyId: code,
        hostId: currentUser.uid,
        status: 'waiting',
        overs: 5,
        lastManStand: false,
        teamAName: 'Team A',
        teamBName: 'Team B',
        messages: [],
        playerIds: [currentUser.uid],
        players: {
          [currentUser.uid]: {
            uid: currentUser.uid,
            name: userName,
            team: 'A',
            isReady: false,
            isCaptain: true,
            isBot: false,
            joinedAt: Date.now()
          }
        }
      };
      await setDoc(doc(db, 'lobbies', code), newLobby);
      setLobbyId(code);
      localStorage.setItem('currentLobby', code);
    } catch (err) {
      setError('Failed to create lobby: ' + err.message);
    }
  }

  async function joinLobby(e) {
    e?.preventDefault();
    try {
      setError('');
      if (!joinCode || joinCode.length !== 6) throw new Error('Invalid code format');
      const ref = doc(db, 'lobbies', joinCode);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Lobby does not exist');

      const data = snap.data();
      if (data.status !== 'waiting') throw new Error('Match already started');
      if (data.playerIds.length >= 22) throw new Error('Lobby is full');
      if (data.playerIds.includes(currentUser.uid)) {
        setLobbyId(joinCode);
        localStorage.setItem('currentLobby', joinCode);
        return;
      }

      const isNameTaken = Object.values(data.players).some(p => p.name === userName);
      const finalName = isNameTaken ? `${userName}_${Math.floor(Math.random() * 100)}` : userName;

      const teamCountA = Object.values(data.players).filter(p => p.team === 'A').length;
      const teamCountB = Object.values(data.players).filter(p => p.team === 'B').length;
      const assignedTeam = teamCountA <= teamCountB ? 'A' : 'B';
      const existingCap = Object.values(data.players).find(p => p.team === assignedTeam && p.isCaptain);

      // Use updateDoc with a single field update for the new player to avoid overwriting the whole 'players' map
      // We use the full UID as key. Firestore dot-notation only triggers if the string literally contains a dot.
      await updateDoc(ref, {
        playerIds: arrayUnion(currentUser.uid),
        [`players.${currentUser.uid}`]: {
          uid: currentUser.uid,
          name: finalName,
          team: assignedTeam,
          isReady: false,
          isCaptain: !existingCap,
          isBot: false,
          joinedAt: Date.now()
        }
      });
      setLobbyId(joinCode);
      localStorage.setItem('currentLobby', joinCode);
    } catch (err) {
      setError(err.message);
    }
  }

  async function spectateLobby(e) {
    if (e) e.preventDefault();
    try {
      setError('');
      if (!joinCode || joinCode.length !== 6) throw new Error('Invalid code format');
      const snap = await getDoc(doc(db, 'lobbies', joinCode));
      if (!snap.exists()) throw new Error('Lobby does not exist');
      setLobbyId(joinCode);
      localStorage.setItem('currentLobby', joinCode);
    } catch (err) {
      setError('Cannot spectate: ' + err.message);
    }
  }

  async function leaveLobby() {
    if (!lobbyData || !lobbyId) return;
    try {
      const ref = doc(db, 'lobbies', lobbyId);
      const me = lobbyData.players[currentUser.uid];
      const updatedPlayers = { ...lobbyData.players };
      delete updatedPlayers[currentUser.uid];
      const newPlayerIds = lobbyData.playerIds.filter(id => id !== currentUser.uid);
      const humansLeft = Object.values(updatedPlayers).filter(p => !p.isBot);

      if (humansLeft.length === 0) {
        await updateDoc(ref, { status: 'abandoned' });
      } else {
        const updates = {
          [`players.${currentUser.uid}`]: deleteField(),
          playerIds: newPlayerIds
        };
        if (lobbyData.hostId === currentUser.uid) {
          const nextHost = humansLeft.sort((a, b) => a.joinedAt - b.joinedAt)[0];
          updates.hostId = nextHost.uid;
        }
        if (me?.isCaptain) {
          const teammates = Object.values(updatedPlayers).filter(p => p.team === me.team && p.uid !== currentUser.uid);
          const humanTeammate = teammates.find(p => !p.isBot);
          const newCap = humanTeammate || teammates[0];
          if (newCap) {
            updates[`players.${newCap.uid}.isCaptain`] = true;
          }
        }
        await updateDoc(ref, updates);
      }
    } catch (err) {
      console.error(err);
    }
    setLobbyId(null);
    setLobbyData(null);
    localStorage.removeItem('currentLobby');
  }

  if (!lobbyId || !lobbyData) {
    return (
      <div className="container center text-center" style={{ color: 'white' }}>
        <div className="card">
          <h2 className="title">Multiplayer</h2>
          {error && <div className="error">{error}</div>}
          <div className="form-group">
            <button onClick={createLobby} className="button primary">Host Game</button>
            <div style={{ margin: '20px 0', borderBottom: '1px solid rgba(255,255,255,0.2)' }} />
            <form className="form-group" onSubmit={joinLobby}>
              <input
                type="text"
                className="input"
                placeholder="6-digit Join Code"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
                maxLength={6}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="button secondary" style={{ flex: 1 }}>Join Game</button>
                <button type="button" onClick={spectateLobby} className="button secondary" style={{ flex: 1 }}>Spectate</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return <LobbyRoom lobbyId={lobbyId} lobbyData={lobbyData} leaveLobby={leaveLobby} />;
}

// ---------------- LOBBY COMPONENT ----------------

function LobbyRoom({ lobbyId, lobbyData, leaveLobby }) {
  const { currentUser } = useAuth();
  const [chatMsg, setChatMsg] = useState('');
  const chatEndRef = useRef(null);

  const playersArr = Object.values(lobbyData.players || {});
  const teamA = playersArr.filter(p => p.team === 'A').sort((a, b) => a.joinedAt - b.joinedAt);
  const teamB = playersArr.filter(p => p.team === 'B').sort((a, b) => a.joinedAt - b.joinedAt);

  const me = lobbyData.players[currentUser.uid] || null; // null for spectators
  const isHost = lobbyData.hostId === currentUser.uid;
  const isAllReady = playersArr.length >= 2 && playersArr.every(p => p.isReady);
  const isValidTeams = teamA.length > 0 && teamA.length === teamB.length;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lobbyData.messages]);

  async function toggleReady() {
    if (!me) return;
    await updateDoc(doc(db, 'lobbies', lobbyId), {
      [`players.${currentUser.uid}.isReady`]: !me.isReady
    });
  }

  async function sendMsg(e) {
    e.preventDefault();
    if (!chatMsg.trim() || !me) return;
    // FIX: use arrayUnion to avoid race-condition message drops
    await updateDoc(doc(db, 'lobbies', lobbyId), {
      messages: arrayUnion({ senderName: me.name, text: chatMsg.trim(), timestamp: Date.now() })
    });
    setChatMsg('');
  }

  async function updateOvers(e) {
    if (!isHost) return;
    await updateDoc(doc(db, 'lobbies', lobbyId), { overs: parseInt(e.target.value) });
  }

  async function toggleLastManStand() {
    if (!isHost) return;
    await updateDoc(doc(db, 'lobbies', lobbyId), { lastManStand: !lobbyData.lastManStand });
  }

  async function addBot(team) {
    if (!isHost) return;
    const botUid = 'bot_' + Math.random().toString(36).substring(2, 11);
    const existingCap = Object.values(lobbyData.players || {}).find(p => p.team === team && p.isCaptain);
    await updateDoc(doc(db, 'lobbies', lobbyId), {
      playerIds: [...lobbyData.playerIds, botUid],
      [`players.${botUid}`]: {
        uid: botUid,
        name: `Bot ${Math.floor(Math.random() * 1000)}`,
        team,
        isReady: true,
        isCaptain: !existingCap,
        isBot: true,
        joinedAt: Date.now()
      }
    });
  }

  async function kickPlayer(uid) {
    if (!isHost || uid === currentUser.uid) return;
    const target = lobbyData.players[uid];
    const updates = {
      [`players.${uid}`]: deleteField(),
      playerIds: lobbyData.playerIds.filter(id => id !== uid)
    };
    if (target?.isCaptain) {
      const teammates = playersArr.filter(p => p.team === target.team && p.uid !== uid);
      const humanTeammate = teammates.find(p => !p.isBot);
      const newCap = humanTeammate || teammates[0];
      if (newCap) updates[`players.${newCap.uid}.isCaptain`] = true;
    }
    await updateDoc(doc(db, 'lobbies', lobbyId), updates);
  }

  async function transferHost(uid) {
    if (!isHost) return;
    await updateDoc(doc(db, 'lobbies', lobbyId), { hostId: uid });
  }

  async function makeCaptain(uid, team) {
    if (!isHost && (!me || !me.isCaptain || me.team !== team)) return;
    const updates = {};
    const currentCap = playersArr.find(p => p.team === team && p.isCaptain);
    if (currentCap) updates[`players.${currentCap.uid}.isCaptain`] = false;
    updates[`players.${uid}.isCaptain`] = true;
    await updateDoc(doc(db, 'lobbies', lobbyId), updates);
  }

  async function assignTeam(uid, team) {
    if (!isHost && uid !== currentUser.uid) return;
    const target = lobbyData.players[uid];
    const updates = { [`players.${uid}.team`]: team };
    if (target?.isCaptain) {
      updates[`players.${uid}.isCaptain`] = false;
      const oldTeammates = playersArr.filter(p => p.team === target.team && p.uid !== uid && !p.isBot);
      if (oldTeammates.length > 0) updates[`players.${oldTeammates[0].uid}.isCaptain`] = true;
    }
    await updateDoc(doc(db, 'lobbies', lobbyId), updates);
  }

  async function renameTeam(team, newName) {
    if (!me || (!me.isCaptain && !isHost)) return;
    if (me.team !== team && !isHost) return;
    await updateDoc(doc(db, 'lobbies', lobbyId), { [`team${team}Name`]: newName });
  }

  async function startMatch() {
    if (!isHost) return;
    if (!isValidTeams) return alert('Teams must have an equal number of players');
    if (!isAllReady) return alert('All players must be ready');
    // Each team must have a captain
    const capA = teamA.find(p => p.isCaptain);
    const capB = teamB.find(p => p.isCaptain);
    if (!capA) return alert('Team A needs a captain');
    if (!capB) return alert('Team B needs a captain');

    const teamAIds = teamA.map(p => p.uid);
    const teamBIds = teamB.map(p => p.uid);

    await setDoc(doc(db, 'matches', lobbyId), {
      status: 'toss',
      matchVersion: ENGINE_CONFIG.VERSION,
      tossCallerTeam: 'A',
      tossCall: null,
      tossCoinResult: null,
      tossWinnerTeam: null,
      tossChoice: null,
      totalOvers: lobbyData.overs,
      lastManStand: !!lobbyData.lastManStand,
      teamLists: { A: teamAIds, B: teamBIds },
      ballInput: { bowler: null, batsman: null },
      history: [],
      lastResult: null,
      outPlayers: [],
      lastOverBowlerId: null,
      processingResult: false,
      consecSixes: 0,
      consecWickets: 0
    });

    await updateDoc(doc(db, 'lobbies', lobbyId), { status: 'in-match' });
  }

  if (lobbyData.status === 'in-match') {
    return <Match lobbyData={lobbyData} matchId={lobbyId} leaveLobby={leaveLobby} />;
  }

  const renderPlayer = (p) => (
    <div key={p.uid} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px', background: 'rgba(255,255,255,0.05)', marginBottom: '5px', borderRadius: '4px'
    }}>
      <div>
        <strong>{p.name}</strong>
        {p.uid === currentUser.uid && ' (You)'}
        {lobbyData.hostId === p.uid && <span style={{ marginLeft: '5px', color: 'var(--primary-color)' }}>[HOST]</span>}
        {p.isCaptain && <span style={{ marginLeft: '5px', color: 'var(--six-color)' }}>[C]</span>}
        {p.isBot && <span style={{ marginLeft: '5px', color: 'var(--text-secondary)' }}>[BOT]</span>}
        {p.isReady
          ? <span style={{ marginLeft: '8px', color: 'var(--success-color)' }}>Ready</span>
          : <span style={{ marginLeft: '8px', color: 'var(--error-color)' }}>Wait</span>}
      </div>
      <div style={{ display: 'flex', gap: '5px' }}>
        {(isHost || p.uid === currentUser.uid) && !isAllReady && (
          <button style={{ fontSize: '10px', padding: '2px 5px' }} onClick={() => assignTeam(p.uid, p.team === 'A' ? 'B' : 'A')}>Swap</button>
        )}
        {isHost && !p.isCaptain && (
          <button style={{ fontSize: '10px', padding: '2px 5px' }} onClick={() => makeCaptain(p.uid, p.team)}>Make Cap</button>
        )}
        {isHost && p.uid !== currentUser.uid && (
          <button style={{ fontSize: '10px', padding: '2px 5px', color: 'var(--error-color)' }} onClick={() => kickPlayer(p.uid)}>Kick</button>
        )}
        {isHost && p.uid !== currentUser.uid && !p.isBot && (
          <button style={{ fontSize: '10px', padding: '2px 5px' }} onClick={() => transferHost(p.uid)}>Host</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="container" style={{ color: 'white', gap: '20px', flexDirection: 'column', maxWidth: '1000px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card-bg)', padding: '15px', borderRadius: '8px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Lobby: <span style={{ color: 'var(--primary-color)' }}>{lobbyId}</span></h2>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{playersArr.length} Players | {lobbyData.overs} Overs</div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {me && (
            <button onClick={toggleReady} className="button" style={{ background: me.isReady ? 'var(--success-color)' : 'gray', width: 'auto', padding: '10px 20px' }}>
              {me.isReady ? 'Ready' : 'Not Ready'}
            </button>
          )}
          {isHost && (
            <button onClick={startMatch} className="button primary" style={{ width: 'auto' }} disabled={!isAllReady || !isValidTeams}>
              Start Match
            </button>
          )}
          <button onClick={leaveLobby} className="button secondary" style={{ width: 'auto' }}>Leave</button>
        </div>
      </div>

      {/* Host Controls */}
      {isHost && (
        <div style={{ background: 'var(--card-bg)', padding: '15px', borderRadius: '8px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Host Controls:</strong>
          <label>Overs:</label>
          <select value={lobbyData.overs} onChange={updateOvers} style={{ background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid var(--overlay-border)', padding: '5px' }}>
            <option value="2">2</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '5px' }}>
            <input type="checkbox" checked={!!lobbyData.lastManStand} onChange={toggleLastManStand} />
            Last Man Stand
          </label>
          <button onClick={() => addBot('A')} className="button secondary" style={{ width: 'auto', padding: '5px 10px', marginLeft: 'auto' }}>+ Bot A</button>
          <button onClick={() => addBot('B')} className="button secondary" style={{ width: 'auto', padding: '5px 10px' }}>+ Bot B</button>
          {!isValidTeams && <span style={{ color: 'var(--four-color)', fontSize: '12px' }}>Teams unbalanced!</span>}
        </div>
      )}

      {/* Teams + Chat */}
      <div className="flex-row-responsive" style={{ flex: 1 }}>
        {/* Team A */}
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '15px', borderRadius: '8px', minHeight: '300px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--overlay-border)', paddingBottom: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              value={lobbyData.teamAName}
              onChange={e => renameTeam('A', e.target.value)}
              disabled={(!me?.isCaptain && !isHost) || isAllReady}
              style={{ background: 'transparent', color: 'white', border: 'none', fontSize: '18px', fontWeight: 'bold', width: '60%' }}
            />
            <span>{teamA.length}/11</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '300px' }}>{teamA.map(renderPlayer)}</div>
        </div>

        {/* Team B */}
        <div style={{ flex: 1, background: 'var(--card-bg)', padding: '15px', borderRadius: '8px', minHeight: '300px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--overlay-border)', paddingBottom: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              value={lobbyData.teamBName}
              onChange={e => renameTeam('B', e.target.value)}
              disabled={(!me?.isCaptain && !isHost) || isAllReady}
              style={{ background: 'transparent', color: 'white', border: 'none', fontSize: '18px', fontWeight: 'bold', width: '60%' }}
            />
            <span>{teamB.length}/11</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: '300px' }}>{teamB.map(renderPlayer)}</div>
        </div>

        {/* Chat */}
        <div style={{ flex: 0.8, background: 'var(--card-bg)', padding: '15px', borderRadius: '8px', display: 'flex', flexDirection: 'column', minHeight: '300px' }}>
          <h3 style={{ borderBottom: '1px solid var(--overlay-border)', paddingBottom: '10px', margin: 0 }}>Lobby Chat</h3>
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '10px' }}>
            {(lobbyData.messages || []).map((msg, i) => (
              <div key={i} style={{ fontSize: '14px' }}>
                <strong style={{ color: 'var(--primary-color)' }}>{msg.senderName}:</strong> {msg.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form onSubmit={sendMsg} style={{ display: 'flex', gap: '5px' }}>
            <input
              type="text"
              value={chatMsg}
              onChange={e => setChatMsg(e.target.value)}
              placeholder={me ? 'Type a message...' : 'Spectators cannot chat'}
              disabled={!me}
              style={{ flex: 1, padding: '8px', borderRadius: '4px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white' }}
            />
            <button type="submit" disabled={!me} className="button primary" style={{ width: 'auto', padding: '8px 15px' }}>Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}
