const socket = io();

let localStream = null;
let muted = false;
let deafened = false;
let joined = false;
let currentChannel = "General";
let currentlySpeaking = false;
let speakingCheckInterval = null;
let speakingAudioContext = null;
let currentUsers = [];

const peers = {};

const username =
  prompt("Escribe tu nombre:") ||
  `Usuario-${Math.floor(Math.random() * 1000)}`;

const joinBtn = document.getElementById("joinBtn");
const muteBtn = document.getElementById("muteBtn");
const deafenBtn = document.getElementById("deafenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const usersDiv = document.getElementById("users");
const myName = document.getElementById("myName");
const channelTitle = document.getElementById("channelTitle");
const channelButtons = document.querySelectorAll(".channelBtn");
const audioContainer = document.getElementById("audioContainer");
const connectionStatus = document.getElementById("connectionStatus");
const voiceStatus = document.getElementById("voiceStatus");

myName.textContent = username;
channelTitle.textContent = `Canal: ${currentChannel}`;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function renderUsers() {
  usersDiv.innerHTML = "";

  if (!joined) {
    usersDiv.innerHTML = "<p>No estás conectado a un canal de voz.</p>";
    return;
  }

  if (currentUsers.length === 0) {
    usersDiv.innerHTML = "<p>No hay usuarios conectados.</p>";
    return;
  }

  currentUsers.forEach((user) => {
    const p = document.createElement("p");
    const icon = user.speaking ? "🟢" : "⚪";
    const micIcon = user.muted ? " 🔇" : " 🎙️";
    const me = user.id === socket.id ? " (tú)" : "";

    p.textContent = `${icon} ${user.username}${me}${micIcon}`;
    usersDiv.appendChild(p);
  });
}

function updateLocalSpeakingState(speaking) {
  const me = currentUsers.find((user) => user.id === socket.id);
  if (!me) return;

  me.speaking = speaking;
  renderUsers();
}

function startSpeakingDetection() {
  stopSpeakingDetection();

  if (!localStream) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  speakingAudioContext = new AudioContextClass();

  const source = speakingAudioContext.createMediaStreamSource(localStream);
  const analyser = speakingAudioContext.createAnalyser();

  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);

  speakingCheckInterval = setInterval(() => {
    if (!joined || !localStream) return;

    analyser.getByteTimeDomainData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      const value = (data[i] - 128) / 128;
      sum += value * value;
    }

    const volume = Math.sqrt(sum / data.length);
    const isSpeaking = !muted && volume > 0.03;

    if (isSpeaking !== currentlySpeaking) {
      currentlySpeaking = isSpeaking;

      socket.emit("user-speaking", {
        speaking: isSpeaking
      });

      updateLocalSpeakingState(isSpeaking);
    }
  }, 120);
}

function stopSpeakingDetection() {
  if (speakingCheckInterval) {
    clearInterval(speakingCheckInterval);
    speakingCheckInterval = null;
  }

  if (speakingAudioContext) {
    speakingAudioContext.close();
    speakingAudioContext = null;
  }

  currentlySpeaking = false;
}

function updateRemoteAudioState() {
  const audios = audioContainer.querySelectorAll("audio");

  audios.forEach((audio) => {
    audio.muted = deafened;
    audio.volume = deafened ? 0 : 1;
  });
}

function createPeerConnection(socketId) {
  const peer = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });
  }

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", {
        target: socketId,
        candidate: event.candidate
      });
    }
  };

  peer.ontrack = (event) => {
    let audio = document.getElementById(`audio-${socketId}`);

    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `audio-${socketId}`;
      audio.autoplay = true;
      audioContainer.appendChild(audio);
    }

    audio.srcObject = event.streams[0];
    audio.muted = deafened;
    audio.volume = deafened ? 0 : 1;
  };

  peers[socketId] = peer;
  return peer;
}

function closeAllPeers() {
  Object.values(peers).forEach((peer) => peer.close());

  Object.keys(peers).forEach((id) => {
    delete peers[id];
  });

  audioContainer.innerHTML = "";
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
}

function resetVoiceUI() {
  joined = false;
  muted = false;
  deafened = false;

  joinBtn.disabled = false;
  joinBtn.textContent = "Entrar al canal";
  muteBtn.textContent = "Silenciar";
  deafenBtn.textContent = "Ensordecer";

  connectionStatus.textContent = "Desconectado";
  voiceStatus.textContent = "Fuera de llamada";
}

joinBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });

    socket.emit("join-channel", {
      username,
      channel: currentChannel
    });

    joined = true;
    joinBtn.disabled = true;
    joinBtn.textContent = "Conectado al canal";
    connectionStatus.textContent = "Conectado";
    voiceStatus.textContent = `En llamada: ${currentChannel}`;

    renderUsers();
    startSpeakingDetection();

    alert("Conectado al canal de voz");
  } catch (error) {
    alert("No se pudo activar el micrófono");
    console.error(error);
  }
});

muteBtn.addEventListener("click", () => {
  if (!localStream) return;

  muted = !muted;

  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });

  muteBtn.textContent = muted ? "Activar micrófono" : "Silenciar";

  socket.emit("user-muted", {
    muted
  });

  const me = currentUsers.find((user) => user.id === socket.id);
  if (me) {
    me.muted = muted;
    renderUsers();
  }

  if (muted && currentlySpeaking) {
    currentlySpeaking = false;

    socket.emit("user-speaking", {
      speaking: false
    });

    updateLocalSpeakingState(false);
  }
});

deafenBtn.addEventListener("click", () => {
  if (!joined) return;

  deafened = !deafened;
  updateRemoteAudioState();

  deafenBtn.textContent = deafened ? "Activar audio" : "Ensordecer";
});

leaveBtn.addEventListener("click", () => {
  if (!joined) return;

  socket.emit("leave-channel");

  closeAllPeers();
  stopSpeakingDetection();
  stopLocalStream();

  currentUsers = [];
  resetVoiceUI();
  renderUsers();
});

channelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const newChannel = button.dataset.channel;

    if (newChannel === currentChannel) return;

    const oldChannel = currentChannel;
    currentChannel = newChannel;

    channelTitle.textContent = `Canal: ${currentChannel}`;
    voiceStatus.textContent = joined
      ? `En llamada: ${currentChannel}`
      : "Fuera de llamada";

    channelButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");

    currentUsers = [];
    renderUsers();

    if (joined) {
      closeAllPeers();

      socket.emit("switch-channel", {
        username,
        oldChannel,
        newChannel
      });
    }
  });
});

socket.on("user-connected", async ({ socketId }) => {
  if (!localStream) return;
  if (peers[socketId]) return;

  const peer = createPeerConnection(socketId);
  const offer = await peer.createOffer();

  await peer.setLocalDescription(offer);

  socket.emit("offer", {
    target: socketId,
    offer
  });
});

socket.on("offer", async ({ sender, offer }) => {
  if (!localStream) return;

  if (peers[sender]) {
    peers[sender].close();
    delete peers[sender];
  }

  const peer = createPeerConnection(sender);

  await peer.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  socket.emit("answer", {
    target: sender,
    answer
  });
});

socket.on("answer", async ({ sender, answer }) => {
  const peer = peers[sender];

  if (peer) {
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

socket.on("ice-candidate", async ({ sender, candidate }) => {
  const peer = peers[sender];

  if (peer && candidate) {
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on("user-disconnected", ({ socketId }) => {
  if (peers[socketId]) {
    peers[socketId].close();
    delete peers[socketId];
  }

  const audio = document.getElementById(`audio-${socketId}`);
  if (audio) audio.remove();
});

socket.on("user-list", (users) => {
  currentUsers = users;
  renderUsers();
});

socket.on("speaking-update", ({ socketId, speaking }) => {
  const user = currentUsers.find((u) => u.id === socketId);
  if (!user) return;

  user.speaking = speaking;
  renderUsers();
});

socket.on("mute-update", ({ socketId, muted }) => {
  const user = currentUsers.find((u) => u.id === socketId);
  if (!user) return;

  user.muted = muted;
  renderUsers();
});

renderUsers();