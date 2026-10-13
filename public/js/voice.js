export function initVoiceChat(socket, remotePlayers, isJoined) {
  const button = document.getElementById('voice-toggle');
  const status = document.getElementById('voice-status');
  const peers = new Map();
  let stream = null;
  let enabled = false;

  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' }
  ];

  function show(message) {
    if (status) status.textContent = message;
  }

  function refresh() {
    if (!button) return;
    button.textContent = enabled ? '🎙 MIC ON' : '🎙 MIC OFF';
    button.classList.toggle('voice-on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    show(enabled ? `Mic live · ${peers.size} voice link(s)` : 'Voice chat off');
  }

  function closePeer(id, notifyPeer = false) {
    const item = peers.get(id);
    if (!item) return;

    if (notifyPeer && socket.connected) {
      socket.emit('voice:leave', { to: id });
    }

    try { item.pc.close(); } catch (_) {}
    item.audio.pause();
    item.audio.srcObject = null;
    item.audio.remove();
    peers.delete(id);
    refresh();
  }

  function makePeer(id) {
    if (peers.has(id)) return peers.get(id);

    const pc = new RTCPeerConnection({ iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);

    const transceiver = pc.addTransceiver('audio', {
      direction: 'sendrecv'
    });

    const item = { pc, audio, transceiver, pending: [] };
    peers.set(id, item);

    if (stream?.getAudioTracks()[0]) {
      transceiver.sender.replaceTrack(stream.getAudioTracks()[0])
        .catch(console.warn);
    }

    pc.onicecandidate = event => {
      if (event.candidate && socket.connected) {
        socket.emit('voice:ice', {
          to: id,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = event => {
      if (event.streams[0]) audio.srcObject = event.streams[0];
      audio.play().catch(() => show('Tap MIC ON to enable audio playback'));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' ||
          pc.connectionState === 'closed') {
        closePeer(id);
      } else if (pc.connectionState === 'connected') {
        show(`Voice connected · ${peers.size} link(s)`);
      }
    };

    refresh();
    return item;
  }

  async function offer(id) {
    if (!socket.connected || !isJoined() || id === socket.id) return;

    // One side initiates each connection to avoid offer collisions.
    if (String(socket.id) > String(id)) return;

    const item = makePeer(id);
    if (item.pc.signalingState !== 'stable' ||
        item.pc.localDescription) return;

    try {
      const description = await item.pc.createOffer();
      await item.pc.setLocalDescription(description);
      socket.emit('voice:offer', {
        to: id,
        sdp: item.pc.localDescription
      });
    } catch (error) {
      console.error('[Voice] Offer error:', error);
      show('Could not start voice connection');
    }
  }

  async function receiveOffer(data) {
    if (!data?.from || !data.sdp) return;
    const item = makePeer(data.from);

    try {
      await item.pc.setRemoteDescription(data.sdp);

      for (const candidate of item.pending.splice(0)) {
        try { await item.pc.addIceCandidate(candidate); }
        catch (_) {}
      }

      const answer = await item.pc.createAnswer();
      await item.pc.setLocalDescription(answer);
      socket.emit('voice:answer', {
        to: data.from,
        sdp: item.pc.localDescription
      });
    } catch (error) {
      console.error('[Voice] Answer error:', error);
      show('Voice connection failed; try again');
    }
  }

  async function receiveAnswer(data) {
    const item = peers.get(data?.from);
    if (!item || !data.sdp) return;

    try {
      await item.pc.setRemoteDescription(data.sdp);

      for (const candidate of item.pending.splice(0)) {
        try { await item.pc.addIceCandidate(candidate); }
        catch (_) {}
      }
    } catch (error) {
      console.error('[Voice] Remote answer error:', error);
    }
  }

  async function receiveIce(data) {
    if (!data?.from || !data.candidate) return;
    const item = peers.get(data.from);
    if (!item) return;

    if (!item.pc.remoteDescription) {
      item.pending.push(data.candidate);
      return;
    }

    try { await item.pc.addIceCandidate(data.candidate); }
    catch (error) { console.warn('[Voice] ICE error:', error); }
  }

  async function toggleMic() {
    if (!enabled) {
      if (!navigator.mediaDevices?.getUserMedia) {
        show('Microphone requires HTTPS or a supported browser');
        return;
      }

      try {
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
        }

        stream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
        enabled = true;

        for (const item of peers.values()) {
          await item.transceiver.sender.replaceTrack(
            stream.getAudioTracks()[0]
          );
        }

        for (const id of remotePlayers.keys()) {
          await offer(id);
        }

        refresh();
        show(peers.size
          ? `Mic live · connecting to ${peers.size} player(s)`
          : 'Mic live · waiting for other players');
      } catch (error) {
        console.error('[Voice] Microphone error:', error);
        enabled = false;
        refresh();
        show(error.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Could not access microphone');
      }
    } else {
      enabled = false;
      stream?.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
      refresh();
    }
  }

  button?.addEventListener('click', toggleMic);
  socket.on('voice:offer', receiveOffer);
  socket.on('voice:answer', receiveAnswer);
  socket.on('voice:ice', receiveIce);
  socket.on('voice:leave', data => {
    if (data?.from) closePeer(data.from);
  });

  socket.on('player:joined', data => {
    if (enabled && data?.id) offer(data.id);
  });

  socket.on('player:left', id => closePeer(id));

  socket.on('disconnect', () => {
    for (const id of [...peers.keys()]) closePeer(id);
    enabled = false;
    stream?.getAudioTracks().forEach(track => {
      track.enabled = false;
    });
    refresh();
  });

  window.addEventListener('beforeunload', () => {
    for (const id of [...peers.keys()]) closePeer(id, true);
    stream?.getTracks().forEach(track => track.stop());
  });

  refresh();
}
