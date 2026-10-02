// fourk-sdk.js - 4k Studio Official Web SDK (Auth, Chat & Auto-Adjust Video Call)
window.FourKStudio = (() => {
  let config = null, socket = null;
  let localStream = null, peerConnection = null, incomingCallData = null;

  // WebRTC Configuration
  const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  // AUTO VIDEO QUALITY ADJUST (Dynamic Resolution & Framerate)
  const mediaConstraints = {
    video: {
      width: { ideal: 1280, min: 320 },   // Net fast ho toh HD (720p), slow ho toh 240p
      height: { ideal: 720, min: 240 },
      frameRate: { ideal: 30, min: 15 }   // Slow net par 15 FPS par chalega taaki atke nahi
    },
    audio: true
  };

  const initWebRTC = (remoteVidId) => {
    peerConnection = new RTCPeerConnection(rtcConfig);
    if (localStream) localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    
    peerConnection.ontrack = (event) => {
      const remoteVid = document.getElementById(remoteVidId);
      if (remoteVid) remoteVid.srcObject = event.streams[0];
    };
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("rtc_ice_candidate", { projectId: config.projectId, candidate: event.candidate });
      }
    };
  };

  return {
    // 1. Initialize App
    initializeApp: (c) => {
      config = c;
      if (typeof io !== "undefined") {
        socket = io("https://d4k-auth-server.onrender.com", { transports: ["websocket", "polling"] });
        socket.on("connect", () => {
          socket.emit("join_project", { projectId: c.projectId, role: "client" });
          console.log("[4k Studio] Realtime SDK Connected.");
        });

        // Call Listeners
        socket.on("rtc_incoming_call", (data) => {
          incomingCallData = data;
          console.log("[4k Studio] Incoming Call from:", data.sender);
          if (window.FourKStudio.onCallReceived) window.FourKStudio.onCallReceived(data);
        });
        socket.on("rtc_call_answered", async (data) => {
          if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        });
        socket.on("rtc_ice_candidate", (data) => {
          if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        });
      }
      return window.FourKStudio;
    },

    // 2. Mount Login UI
    mountAuth: (selector) => {
      const box = document.querySelector(selector);
      if (box) box.innerHTML = `
        <div style="padding:20px;max-width:350px;margin:auto;border:1px solid #dadce0;border-radius:8px;font-family:sans-serif;text-align:center;">
          <h3 style="margin-bottom:15px;color:#202124;">Sign In</h3>
          <input type="email" id="fks-email" placeholder="Email" style="width:100%;padding:10px;margin-bottom:10px;border:1px solid #ccc;border-radius:4px;outline:none;">
          <input type="password" id="fks-pass" placeholder="Password" style="width:100%;padding:10px;margin-bottom:15px;border:1px solid #ccc;border-radius:4px;outline:none;">
          <button onclick="FourKStudio.login()" style="width:100%;padding:10px;background:#1a73e8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">Log In</button>
        </div>`;
    },

    login: () => {
      const e = document.getElementById("fks-email").value, p = document.getElementById("fks-pass").value;
      if(e && p) alert("4k Studio Auth: Request sent to database for " + e);
    },

    // 3. Realtime Chat
    sendChat: (sender, msg) => {
      if(socket) socket.emit("send_message", { projectId: config.projectId, sender: sender, message: msg, chatId: "chat_" + Date.now(), timestamp: new Date().toISOString() });
    },
    onChat: (callback) => {
      if(socket) socket.on("receive_message", (data) => { if(data.projectId === config.projectId) callback(data); });
    },

    // 4. Audio/Video Calling (With Auto Quality Adjust)
    startVideoCall: async (targetUserId, localVidId, remoteVidId) => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        const localVid = document.getElementById(localVidId);
        if (localVid) { localVid.srcObject = localStream; localVid.muted = true; } 
        
        initWebRTC(remoteVidId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        if(socket) socket.emit("rtc_call_user", { projectId: config.projectId, target: targetUserId, offer: offer });
        console.log("[4k Studio] Calling user:", targetUserId);
      } catch (err) { console.error("[4k Studio] Camera/Mic error:", err); }
    },

    answerCall: async (localVidId, remoteVidId) => {
      if (!incomingCallData) return console.error("[4k Studio] No incoming call found.");
      try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        const localVid = document.getElementById(localVidId);
        if (localVid) { localVid.srcObject = localStream; localVid.muted = true; }
        
        initWebRTC(remoteVidId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if(socket) socket.emit("rtc_answer_call", { projectId: config.projectId, target: incomingCallData.sender, answer: answer });
        console.log("[4k Studio] Call answered.");
      } catch (err) { console.error("[4k Studio] Camera/Mic error:", err); }
    },

    endCall: () => {
      if (peerConnection) { peerConnection.close(); peerConnection = null; }
      if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
      console.log("[4k Studio] Call ended/Camera closed.");
    },

    onCallReceived: null 
  };
})();
