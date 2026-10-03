// =======================================================
// 4K STUDIO SECURE WEB SDK (HEADLESS LOGIC)
// =======================================================

class FourKStudioAuth {
    constructor(core) {
        this.core = core;
    }

    async _request(endpoint, body) {
        const res = await fetch(`${this.core.serverUrl}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, projectId: this.core.projectId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.details || "Request failed");
        return data;
    }

    async login(email, password) {
        const data = await this._request("/api/console/login", { adminEmail: email, adminPassword: password });
        // Security: Login success hone par Token save karein
        if (data.consoleToken || data.token) {
            this.core.authToken = data.consoleToken || data.token;
        }
        return data;
    }

    async sendOtp(name, email, password) {
        return await this._request("/api/console/register-send-otp", { developerName: name, projectName: "App User", adminEmail: email, adminPassword: password });
    }

    async verifyOtp(email, otp) {
        const data = await this._request("/api/console/verify-project-otp", { adminEmail: email, otp: otp });
        // Security: OTP verify hone par Token save karein
        if (data.consoleToken || data.token) {
            this.core.authToken = data.consoleToken || data.token;
        }
        return data;
    }

    async sendMagicLink(email) {
        return await this._request("/api/auth/send-magic-link", { email: email, redirectUrl: window.location.href.split("?")[0] });
    }
}

class FourKStudioDatabase {
    constructor(core) {
        this.core = core;
        this.socket = null;
    }

    connect(userEmail) {
        // SECURITY CHECK: Bina Token ke connect nahi hone dena
        if (!this.core.authToken) {
            console.error("⛔ 4K Studio Security: Access Denied. You must log in first.");
            throw new Error("Unauthorized: Please login to connect to the realtime database.");
        }

        if (!this.socket && typeof io !== "undefined") {
            // Socket connection mein Token bhej rahe hain taaki server bhi verify kar sake
            this.socket = io(this.core.serverUrl, { 
                transports: ["websocket"],
                auth: { token: this.core.authToken }
            });
            this.socket.emit("join_project", { 
                projectId: this.core.projectId, 
                email: userEmail,
                token: this.core.authToken 
            });
        } else if (typeof io === "undefined") {
            console.error("4K Studio: Socket.io library missing. Please include it.");
        }
    }

    sendMessage(senderName, text) {
        // SECURITY CHECK: Bina socket connection aur token ke message block karna
        if (!this.socket || !this.core.authToken) {
            console.error("⛔ 4K Studio Security: Cannot send message. Connection blocked.");
            throw new Error("Unauthorized: Database not connected or user not logged in.");
        }
        const msgData = { 
            projectId: this.core.projectId, 
            sender: senderName, 
            message: text, 
            timestamp: new Date().toISOString(),
            token: this.core.authToken 
        };
        this.socket.emit("send_message", msgData);
        this.socket.emit("chat_message", msgData); 
    }

    onMessage(callback) {
        if (!this.socket) return;
        this.socket.on("chat_message", (data) => {
            if (data.projectId === this.core.projectId) callback(data);
        });
    }
}

class FourKStudioWebRTC {
    constructor(db) {
        this.db = db;
        this.peerConnection = null;
        this.localStream = null;
        this.iceServers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    }

    async initCamera(localVideoId) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 } }, 
                audio: true 
            });
            const videoEl = document.getElementById(localVideoId);
            if(videoEl) videoEl.srcObject = this.localStream;
            return true;
        } catch (err) {
            console.error("4K Studio Calling: Camera/Mic access denied", err);
            return false;
        }
    }

    _setupPeer(remoteVideoId) {
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        this.localStream.getTracks().forEach(track => this.peerConnection.addTrack(track, this.localStream));
        
        const remoteStream = new MediaStream();
        const remoteEl = document.getElementById(remoteVideoId);
        if(remoteEl) remoteEl.srcObject = remoteStream;

        this.peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.db.socket) {
                this.db.socket.emit("webrtc_signal", { 
                    projectId: this.db.core.projectId, 
                    type: "ice-candidate", 
                    candidate: event.candidate,
                    token: this.db.core.authToken // Calling mein bhi token jayega
                });
            }
        };
    }

    async startCall(localVideoId, remoteVideoId) {
        // SECURITY CHECK: Database connect (yaani login) hona zaroori hai
        if(!this.db.socket || !this.db.core.authToken) {
            throw new Error("⛔ 4K Studio Security: Call blocked. User not authenticated.");
        }
        
        const camReady = await this.initCamera(localVideoId);
        if(!camReady) return;

        this._setupPeer(remoteVideoId);
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        this.db.socket.emit("webrtc_signal", { 
            projectId: this.db.core.projectId, 
            type: "call-offer", 
            offer: offer,
            token: this.db.core.authToken 
        });
    }

    listenForCalls(localVideoId, remoteVideoId, onIncomingCallCallback) {
        if (!this.db.socket) return;
        
        this.db.socket.on("webrtc_signal", async (data) => {
            if (data.projectId !== this.db.core.projectId) return;

            if (data.type === "call-offer") {
                onIncomingCallCallback();
                await this.initCamera(localVideoId);
                this._setupPeer(remoteVideoId);
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                this.db.socket.emit("webrtc_signal", { 
                    projectId: this.db.core.projectId, 
                    type: "call-answer", 
                    answer: answer,
                    token: this.db.core.authToken 
                });
            } 
            else if (data.type === "call-answer") {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } 
            else if (data.type === "ice-candidate" && this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });
    }

    endCall() {
        if(this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if(this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
}

// =======================================================
// MAIN EXPORT
// =======================================================
window.FourKStudio = {
    initializeApp: function(config) {
        const core = {
            projectId: config.projectId,
            apiKey: config.apiKey,
            serverUrl: "https://d4k-auth-server.onrender.com",
            authToken: null // Default null. Login ke baad hi set hoga.
        };

        const dbModule = new FourKStudioDatabase(core);

        return {
            auth: new FourKStudioAuth(core),
            database: dbModule,
            calling: new FourKStudioWebRTC(dbModule)
        };
    }
};
