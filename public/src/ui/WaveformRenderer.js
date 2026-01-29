/**
 * WaveformRenderer - Handles canvas-based audio visualization
 * Renders both horizontal waveform (user mic) and circular ring (assistant audio)
 */
export class WaveformRenderer {
    constructor(waveformCanvas, ringCanvas) {
        this.waveformCanvas = waveformCanvas;
        this.ringCanvas = ringCanvas;
        this.ctx = waveformCanvas.getContext('2d');
        this.ringCtx = ringCanvas.getContext('2d');

        // Animation state
        this.animationId = null;
        this.isAnimating = false;
        this.hueRotation = 0;

        // Audio levels (smoothed)
        this.audioLevel = 0;
        this.targetAudioLevel = 0;
        this.assistantAudioLevel = 0;
        this.targetAssistantAudioLevel = 0;

        // Ring fade state
        this.ringFadeAlpha = 0;
        this.isRingFadingOut = false;

        // Audio tracking
        this.speechStartTime = 0;
        this.totalAudioDuration = 0;
        this.audioFadeTimer = null;

        // Particles system
        this.particles = [];
        this.maxParticles = 30;

        // Visual state
        this.visualState = 'idle'; // idle, listening, speaking
        this.stateTransition = 0;

        this.initCanvas();
        this.initParticles();
    }

    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        const rect = this.waveformCanvas.getBoundingClientRect();
        return {
            x: Math.random() * rect.width,
            y: Math.random() * rect.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            size: Math.random() * 3 + 1,
            alpha: Math.random() * 0.5 + 0.2,
            hue: Math.random() * 60 + 270, // Violet-pink range (Nova colors)
            pulseOffset: Math.random() * Math.PI * 2
        };
    }

    setVisualState(state) {
        if (this.visualState !== state) {
            this.visualState = state;
            this.stateTransition = 0;
        }
    }

    initCanvas() {
        const dpr = window.devicePixelRatio || 1;

        // Main waveform canvas (full width)
        const rect = this.waveformCanvas.getBoundingClientRect();
        this.waveformCanvas.width = rect.width * dpr;
        this.waveformCanvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        // Ring canvas (around button) - fixed size matching CSS
        const ringSize = 200;
        this.ringCanvas.width = ringSize * dpr;
        this.ringCanvas.height = ringSize * dpr;
        this.ringCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.ringCtx.scale(dpr, dpr);
    }

    start() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.animate();
    }

    stop() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.audioFadeTimer) {
            clearTimeout(this.audioFadeTimer);
            this.audioFadeTimer = null;
        }
        // Reset state
        this.targetAudioLevel = 0;
        this.targetAssistantAudioLevel = 0;
        this.audioLevel = 0;
        this.assistantAudioLevel = 0;
        this.speechStartTime = 0;
        this.totalAudioDuration = 0;
        this.ringFadeAlpha = 0;
        this.isRingFadingOut = false;
        this.visualState = 'idle';
        this.stateTransition = 0;

        // Clear canvases
        const rect = this.waveformCanvas.getBoundingClientRect();
        this.ctx.clearRect(0, 0, rect.width, rect.height);
        this.ringCtx.clearRect(0, 0, 200, 200);
    }

    updateAudioLevel(level) {
        this.targetAudioLevel = Math.min(1, level * 3);
    }

    updateAssistantAudioLevel(level) {
        this.targetAssistantAudioLevel = Math.min(1, level * 3);
    }

    /**
     * Called when assistant audio chunk is received
     * @param {number} chunkDurationMs - Duration of the audio chunk in milliseconds
     */
    onAssistantAudioChunk(chunkDurationMs) {
        if (this.speechStartTime === 0) {
            this.speechStartTime = Date.now();
            this.totalAudioDuration = 0;
            this.isRingFadingOut = false;
            this.ringFadeAlpha = 1;
        }
        this.totalAudioDuration += chunkDurationMs;

        if (this.audioFadeTimer) {
            clearTimeout(this.audioFadeTimer);
            this.audioFadeTimer = null;
        }
    }

    /**
     * Called when assistant audio content ends
     * @param {number} audioBufferMs - Audio buffer delay in milliseconds
     */
    onAssistantAudioEnd(audioBufferMs) {
        if (this.isRingFadingOut) return;

        const elapsedSinceSpeechStart = Date.now() - this.speechStartTime;
        const remainingPlayback = Math.max(0, this.totalAudioDuration + audioBufferMs - elapsedSinceSpeechStart);

        if (this.audioFadeTimer) {
            clearTimeout(this.audioFadeTimer);
        }

        this.audioFadeTimer = setTimeout(() => {
            this.isRingFadingOut = true;
            this.targetAssistantAudioLevel = 0;

            setTimeout(() => {
                this.speechStartTime = 0;
                this.totalAudioDuration = 0;
                this.audioFadeTimer = null;
            }, 1500);
        }, remainingPlayback);
    }

    /**
     * Called on barge-in or interruption - immediately stop ring animation
     */
    onInterrupt() {
        if (this.audioFadeTimer) {
            clearTimeout(this.audioFadeTimer);
            this.audioFadeTimer = null;
        }
        this.isRingFadingOut = true;
        this.targetAssistantAudioLevel = 0;
        this.assistantAudioLevel = 0;
        this.speechStartTime = 0;
        this.totalAudioDuration = 0;
    }

    animate() {
        if (!this.isAnimating) return;

        const rect = this.waveformCanvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const centerY = height / 2;
        const time = Date.now() * 0.004;

        this.ctx.clearRect(0, 0, width, height);

        // Smooth audio level transitions
        this.audioLevel += (this.targetAudioLevel - this.audioLevel) * 0.18;

        const isActivelyReceivingAudio = this.speechStartTime > 0 && !this.isRingFadingOut && this.ringFadeAlpha === 1;
        const effectiveTargetAssistantLevel = isActivelyReceivingAudio 
            ? Math.max(this.targetAssistantAudioLevel, 0.5) 
            : this.targetAssistantAudioLevel;
        const assistantSmoothing = effectiveTargetAssistantLevel < this.assistantAudioLevel ? 0.03 : 0.15;
        this.assistantAudioLevel += (effectiveTargetAssistantLevel - this.assistantAudioLevel) * assistantSmoothing;

        // Update state transition
        this.stateTransition = Math.min(1, this.stateTransition + 0.02);

        const userLevel = this.audioLevel;
        const baseAmplitude = 1 + userLevel * 59;
        const vibrationIntensity = 0.005 + userLevel * 0.995;

        // Draw ambient background glow
        this.drawAmbientGlow(width, height, time, userLevel);

        // Draw and update particles
        this.updateAndDrawParticles(width, height, time, userLevel);

        // Draw main waveform with reflection
        this.drawHorizontalWave(width, centerY, baseAmplitude, time, userLevel, vibrationIntensity);

        // Draw circular ring
        this.drawCircularRing(time);

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    drawAmbientGlow(width, height, time, level) {
        if (level < 0.01 && this.assistantAudioLevel < 0.01) return;

        const combinedLevel = Math.max(level, this.assistantAudioLevel * 0.7);
        const pulse = Math.sin(time * 2) * 0.3 + 0.7;
        const alpha = combinedLevel * 0.15 * pulse;

        // Nova colors: violet (270) to pink (330)
        let hue = 270; // Violet default
        if (this.visualState === 'listening') {
            hue = 160; // Emerald for listening
        } else if (this.visualState === 'speaking') {
            hue = 300; // Pink-violet for speaking
        }

        const gradient = this.ctx.createRadialGradient(
            width / 2, height / 2, 0,
            width / 2, height / 2, Math.max(width, height) * 0.6
        );
        gradient.addColorStop(0, `hsla(${hue}, 70%, 55%, ${alpha})`);
        gradient.addColorStop(0.5, `hsla(${hue}, 60%, 45%, ${alpha * 0.5})`);
        gradient.addColorStop(1, 'transparent');

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);
    }

    updateAndDrawParticles(width, height, time, level) {
        const combinedLevel = Math.max(level, this.assistantAudioLevel * 0.5);
        if (combinedLevel < 0.02) return;

        const centerY = height / 2;

        this.particles.forEach(p => {
            // Update position with audio reactivity
            const audioInfluence = combinedLevel * 2;
            p.x += p.vx + Math.sin(time + p.pulseOffset) * audioInfluence;
            p.y += p.vy + Math.cos(time * 0.7 + p.pulseOffset) * audioInfluence * 0.5;

            // Attract towards center when audio is active
            const dx = width / 2 - p.x;
            const dy = centerY - p.y;
            p.x += dx * 0.001 * combinedLevel;
            p.y += dy * 0.002 * combinedLevel;

            // Wrap around edges
            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            // Draw particle
            const pulse = Math.sin(time * 3 + p.pulseOffset) * 0.5 + 0.5;
            const size = p.size * (1 + combinedLevel * 2 * pulse);
            const alpha = p.alpha * combinedLevel * (0.5 + pulse * 0.5);

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${p.hue + time * 10}, 80%, 70%, ${alpha})`;
            this.ctx.fill();

            // Glow effect
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, size * 2, 0, Math.PI * 2);
            this.ctx.fillStyle = `hsla(${p.hue + time * 10}, 80%, 60%, ${alpha * 0.3})`;
            this.ctx.fill();
        });
    }

    drawHorizontalWave(width, centerY, amplitude, time, level, vibrationIntensity) {
        const freq = 0.012;
        const phase = time * 4;

        // Calculate wave points once for both main and reflection
        const wavePoints = [];
        for (let x = 0; x <= width; x += 1) {
            const wave1 = Math.sin(x * freq + phase) * amplitude;
            const wave2 = Math.sin(x * freq * 2.3 + phase * 2.5) * amplitude * 0.6;
            const wave3 = Math.sin(x * freq * 0.7 + phase * 1.2) * amplitude * 0.5;
            const vibration = Math.sin(x * 0.1 + time * 25) * amplitude * 0.45 * vibrationIntensity;
            const microVibration = Math.sin(x * 0.25 + time * 45) * amplitude * 0.35 * vibrationIntensity;
            const bounce = Math.sin(time * 35) * amplitude * 0.4 * vibrationIntensity;
            const bounce2 = Math.cos(time * 28) * amplitude * 0.3 * vibrationIntensity;
            const rapidPulse = Math.sin(time * 60 + x * 0.03) * amplitude * 0.25 * vibrationIntensity;
            const jitter = (Math.sin(x * 0.4 + time * 50) * Math.cos(x * 0.22 + time * 35)) * amplitude * 0.4 * level;
            const chaos = Math.sin(x * 0.6 + time * 70) * amplitude * 0.2 * level;
            const chaos2 = Math.cos(x * 0.35 + time * 55) * Math.sin(time * 80) * amplitude * 0.25 * level;
            const spikes = Math.sin(x * 0.8 + time * 90) * amplitude * 0.15 * vibrationIntensity;

            const offset = wave1 + wave2 + wave3 + vibration + microVibration + 
                          bounce + bounce2 + rapidPulse + jitter + chaos + chaos2 + spikes;
            wavePoints.push({ x, offset });
        }

        this.hueRotation = (this.hueRotation + 0.3) % 60; // Slower rotation within violet-pink range
        const hue1 = 270 + this.hueRotation; // Violet base
        const hue2 = 300 + this.hueRotation * 0.5; // Pink-violet
        const hue3 = 330; // Pink accent

        const gradient = this.ctx.createLinearGradient(0, 0, width, 0);
        const alpha = 0.7 + level * 0.3;
        gradient.addColorStop(0, `hsla(${hue1}, 75%, 60%, ${alpha})`);
        gradient.addColorStop(0.33, `hsla(${hue2}, 70%, 65%, ${alpha})`);
        gradient.addColorStop(0.66, `hsla(${hue3}, 75%, 60%, ${alpha})`);
        gradient.addColorStop(1, `hsla(${hue1}, 70%, 65%, ${alpha})`);

        // Draw reflection first (behind main wave)
        if (level > 0.05) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.moveTo(0, centerY);
            wavePoints.forEach(p => {
                this.ctx.lineTo(p.x, centerY - p.offset * 0.4); // Inverted and smaller
            });

            const reflectionAlpha = level * 0.25;
            const reflectionGradient = this.ctx.createLinearGradient(0, centerY, 0, centerY - 40);
            reflectionGradient.addColorStop(0, `hsla(${hue2}, 80%, 60%, ${reflectionAlpha})`);
            reflectionGradient.addColorStop(1, `hsla(${hue2}, 80%, 60%, 0)`);

            this.ctx.strokeStyle = reflectionGradient;
            this.ctx.lineWidth = 1 + level;
            this.ctx.globalAlpha = 0.4;
            this.ctx.filter = 'blur(2px)';
            this.ctx.stroke();
            this.ctx.restore();
        }

        // Draw main wave
        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);
        wavePoints.forEach(p => {
            this.ctx.lineTo(p.x, centerY + p.offset);
        });

        this.ctx.save();
        this.ctx.shadowColor = `hsla(${hue2}, 75%, 60%, ${0.4 + level * 0.4})`;
        this.ctx.shadowBlur = 25 + level * 40;
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = 2 + level * 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();

        this.ctx.shadowColor = `hsla(${hue1}, 70%, 70%, ${0.5 + level * 0.3})`;
        this.ctx.shadowBlur = 15 + level * 25;
        this.ctx.stroke();

        this.ctx.shadowColor = `hsla(${hue3}, 75%, 75%, ${0.6 + level * 0.4})`;
        this.ctx.shadowBlur = 8 + level * 15;
        this.ctx.lineWidth = 1.5 + level * 1.5;
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawCircularRing(time) {
        const ringSize = 200;
        this.ringCtx.clearRect(0, 0, ringSize, ringSize);

        // Update ring fade alpha
        if (this.assistantAudioLevel > 0.02 && !this.isRingFadingOut) {
            this.ringFadeAlpha = 1;
        } else if (this.isRingFadingOut && this.ringFadeAlpha > 0) {
            this.ringFadeAlpha -= 0.02;
            if (this.ringFadeAlpha <= 0) {
                this.ringFadeAlpha = 0;
                this.isRingFadingOut = false;
                this.assistantAudioLevel = 0;
                this.targetAssistantAudioLevel = 0;
            }
        }

        if (this.ringFadeAlpha <= 0 || (this.assistantAudioLevel <= 0.02 && !this.isRingFadingOut)) {
            return;
        }

        const centerX = ringSize / 2;
        const centerY = ringSize / 2;
        const level = this.isRingFadingOut ? Math.max(0.4, this.assistantAudioLevel) : this.assistantAudioLevel;

        const buttonRadius = 50;
        const ringRadius = buttonRadius + 12 + level * 15;
        
        // Nova colors: violet (270) to pink (330)
        const baseHue = 270;
        const hue = level > 0.1 ? 270 + (Math.sin(time * 2) * 30) : baseHue; // Oscillate between violet and pink
        const alpha = (0.6 + level * 0.4) * this.ringFadeAlpha;

        const segments = 120;
        this.ringCtx.beginPath();

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const vibration = Math.sin(angle * 8 + time * 12) * 8 * level;
            const microVibration = Math.sin(angle * 16 + time * 20) * 5 * level;
            const pulse = Math.sin(time * 5) * 6 * level;
            const jitter = Math.sin(angle * 24 + time * 30) * 3 * level;
            const r = ringRadius + vibration + microVibration + pulse + jitter;

            const x = centerX + Math.cos(angle) * r;
            const y = centerY + Math.sin(angle) * r;

            if (i === 0) this.ringCtx.moveTo(x, y);
            else this.ringCtx.lineTo(x, y);
        }
        this.ringCtx.closePath();

        this.ringCtx.save();
        // Violet glow
        this.ringCtx.shadowColor = `hsla(${hue}, 80%, 60%, ${alpha * 0.8})`;
        this.ringCtx.shadowBlur = 30 + level * 50;
        this.ringCtx.strokeStyle = `hsla(${hue}, 75%, 65%, ${alpha})`;
        this.ringCtx.lineWidth = 2 + level * 3;
        this.ringCtx.stroke();

        // Pink accent
        const hue2 = 330; // Pink
        this.ringCtx.shadowColor = `hsla(${hue2}, 80%, 60%, ${alpha * 0.6})`;
        this.ringCtx.shadowBlur = 20 + level * 35;
        this.ringCtx.stroke();

        // Light violet highlight
        const hue3 = 280;
        this.ringCtx.shadowColor = `hsla(${hue3}, 70%, 70%, ${alpha * 0.7})`;
        this.ringCtx.shadowBlur = 10 + level * 20;
        this.ringCtx.lineWidth = 1 + level * 2;
        this.ringCtx.stroke();
        this.ringCtx.restore();
    }
}
