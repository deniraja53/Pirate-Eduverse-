/**
 * Hybrid Audio Service for Pirate Academy 3D:
 * - Procedural Web Audio API sound effects (click, jump, chest, correct, wrong, victory, step)
 * - Singleton Pirate Soundtrack player (/ebunny-pirate-jolly-roger-loop-369969.mp3)
 *   with smooth fade-in / fade-out, loop playback, autoplay-block recovery,
 *   and independent music ON/OFF + volume control (default 25%).
 * Created by Deni Raja99
 */

export const PIRATE_SOUNDTRACK_PATH = '/ebunny-pirate-jolly-roger-loop-369969.mp3';
export const DEFAULT_MUSIC_VOLUME = 0.25;

export interface AudioStateSnapshot {
  sfxMuted: boolean;
  musicEnabled: boolean;
  musicVolume: number; // 0..1
  musicPlaying: boolean;
  musicBlocked: boolean;
}

type AudioListener = (state: AudioStateSnapshot) => void;

class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false; // SFX mute flag (independent from music)

  // Singleton soundtrack state
  private musicAudio: HTMLAudioElement | null = null;
  private musicEnabled: boolean = true;
  private musicVolume: number = DEFAULT_MUSIC_VOLUME;
  private musicWantsToPlay: boolean = false;
  private musicBlocked: boolean = false;
  private fadeRafId: number | null = null;
  private gestureListenerAttached: boolean = false;
  private listeners = new Set<AudioListener>();

  private notifyListeners() {
    const snap = this.getState();
    this.listeners.forEach((cb) => {
      try {
        cb(snap);
      } catch {
        // ignore listener errors
      }
    });
  }

  public getState(): AudioStateSnapshot {
    return {
      sfxMuted: this.isMuted,
      musicEnabled: this.musicEnabled,
      musicVolume: this.musicVolume,
      musicPlaying: Boolean(this.musicAudio && !this.musicAudio.paused && this.musicEnabled),
      musicBlocked: this.musicBlocked,
    };
  }

  public subscribe(listener: AudioListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private initContext() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // ========================
  // SFX CONTROLS
  // ========================

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    this.notifyListeners();
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  // ========================
  // PIRATE SOUNDTRACK (SINGLETON)
  // ========================

  private ensureMusicElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;

    if (!this.musicAudio) {
      const audio = new Audio(PIRATE_SOUNDTRACK_PATH);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;

      audio.addEventListener('play', () => {
        this.musicBlocked = false;
        this.notifyListeners();
      });
      audio.addEventListener('pause', () => {
        this.notifyListeners();
      });
      audio.addEventListener('error', () => {
        // Keep app safe if audio fails to load
        this.notifyListeners();
      });

      this.musicAudio = audio;
    }
    return this.musicAudio;
  }

  private attachGestureRetry() {
    if (typeof window === 'undefined' || this.gestureListenerAttached) return;
    this.gestureListenerAttached = true;

    const handleUserGesture = () => {
      this.detachGestureRetry();
      this.initContext();
      if (this.musicWantsToPlay && this.musicEnabled) {
        this.tryPlayMusicWithFade(550);
      }
    };

    window.addEventListener('pointerdown', handleUserGesture, { once: true, passive: true });
    window.addEventListener('keydown', handleUserGesture, { once: true, passive: true });
    window.addEventListener('touchstart', handleUserGesture, { once: true, passive: true });
  }

  private detachGestureRetry() {
    this.gestureListenerAttached = false;
  }

  private cancelFade() {
    if (this.fadeRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.fadeRafId);
      this.fadeRafId = null;
    }
  }

  private fadeVolumeTo(targetVolume: number, durationMs: number, onComplete?: () => void) {
    const audio = this.musicAudio;
    if (!audio) {
      onComplete?.();
      return;
    }

    this.cancelFade();

    const clampedTarget = Math.max(0, Math.min(1, targetVolume));
    const startVol = audio.volume;

    if (durationMs <= 0 || Math.abs(startVol - clampedTarget) < 0.005) {
      audio.volume = clampedTarget;
      onComplete?.();
      return;
    }

    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      // Smooth ease-out curve
      const eased = 1 - Math.pow(1 - progress, 2);
      audio.volume = Math.max(0, Math.min(1, startVol + (clampedTarget - startVol) * eased));

      if (progress < 1) {
        this.fadeRafId = requestAnimationFrame(tick);
      } else {
        this.fadeRafId = null;
        audio.volume = clampedTarget;
        onComplete?.();
      }
    };

    this.fadeRafId = requestAnimationFrame(tick);
  }

  private tryPlayMusicWithFade(fadeMs: number) {
    const audio = this.ensureMusicElement();
    if (!audio || !this.musicEnabled || !this.musicWantsToPlay) return;

    // Never restart or create a duplicate instance if already actively playing
    if (!audio.paused) {
      this.fadeVolumeTo(this.musicVolume, fadeMs);
      return;
    }

    audio.volume = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.musicBlocked = false;
          if (this.musicWantsToPlay && this.musicEnabled) {
            this.fadeVolumeTo(this.musicVolume, fadeMs);
          } else {
            audio.pause();
          }
          this.notifyListeners();
        })
        .catch(() => {
          // Browser blocked autoplay before user gesture: handle cleanly without error
          this.musicBlocked = true;
          this.attachGestureRetry();
          this.notifyListeners();
        });
    }
  }

  /**
   * Call during a valid user gesture (e.g. clicking "Mulai" or "Mulai Petualangan 3D")
   * so AudioContext & HTMLAudioElement are warmed up cleanly.
   */
  public unlockAudio() {
    this.initContext();
    this.ensureMusicElement();
  }

  /**
   * Starts gameplay background soundtrack (idempotent: does NOT restart if already playing).
   */
  public startGameplayMusic() {
    this.musicWantsToPlay = true;
    const audio = this.ensureMusicElement();
    if (!audio) return;

    if (!this.musicEnabled) {
      this.notifyListeners();
      return;
    }

    // If already playing, preserve currentTime and never restart
    if (!audio.paused) {
      if (Math.abs(audio.volume - this.musicVolume) > 0.01) {
        this.fadeVolumeTo(this.musicVolume, 350);
      }
      this.notifyListeners();
      return;
    }

    this.tryPlayMusicWithFade(800);
  }

  /**
   * Smoothly fades out and pauses soundtrack when leaving gameplay screens.
   */
  public stopGameplayMusic(resetPosition: boolean = false) {
    this.musicWantsToPlay = false;
    this.musicBlocked = false;
    const audio = this.musicAudio;
    if (!audio) {
      this.notifyListeners();
      return;
    }

    if (audio.paused) {
      if (resetPosition) audio.currentTime = 0;
      this.notifyListeners();
      return;
    }

    this.fadeVolumeTo(0, 450, () => {
      if (!this.musicWantsToPlay) {
        audio.pause();
        if (resetPosition) {
          audio.currentTime = 0;
        }
        this.notifyListeners();
      }
    });
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    const audio = this.ensureMusicElement();

    if (!enabled) {
      this.musicBlocked = false;
      if (audio && !audio.paused) {
        this.fadeVolumeTo(0, 220, () => {
          if (!this.musicEnabled) {
            audio.pause();
            this.notifyListeners();
          }
        });
      } else {
        this.notifyListeners();
      }
      return;
    }

    // Re-enabled: resume from currentTime without creating duplicate Audio instance
    if (this.musicWantsToPlay) {
      this.tryPlayMusicWithFade(400);
    } else {
      this.notifyListeners();
    }
  }

  public toggleMusic(): boolean {
    this.setMusicEnabled(!this.musicEnabled);
    return this.musicEnabled;
  }

  public setMusicVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    this.musicVolume = clamped;

    if (this.musicAudio && this.musicEnabled && !this.musicAudio.paused) {
      this.cancelFade();
      this.musicAudio.volume = clamped;
    }

    this.notifyListeners();
  }

  // ========================
  // SOUND EFFECTS (SFX)
  // ========================

  /**
   * Button click sound
   */
  public playClick() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.09);
    } catch {
      // Audio safety
    }
  }

  /**
   * Jump sound
   */
  public playJump() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.18);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.19);
    } catch {}
  }

  /**
   * Chest opening creak + gold shimmer
   */
  public playChestOpen() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;

      const creakOsc = this.ctx.createOscillator();
      const creakGain = this.ctx.createGain();
      creakOsc.type = 'sawtooth';
      creakOsc.frequency.setValueAtTime(140, now);
      creakOsc.frequency.linearRampToValueAtTime(110, now + 0.2);
      creakGain.gain.setValueAtTime(0.1, now);
      creakGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      creakOsc.connect(creakGain);
      creakGain.connect(this.ctx.destination);
      creakOsc.start(now);
      creakOsc.stop(now + 0.26);

      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, idx) => {
        const chimeOsc = this.ctx!.createOscillator();
        const chimeGain = this.ctx!.createGain();
        chimeOsc.type = 'sine';
        chimeOsc.frequency.setValueAtTime(freq, now + 0.15 + idx * 0.08);
        chimeGain.gain.setValueAtTime(0.1, now + 0.15 + idx * 0.08);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6 + idx * 0.08);

        chimeOsc.connect(chimeGain);
        chimeGain.connect(this.ctx!.destination);

        chimeOsc.start(now + 0.15 + idx * 0.08);
        chimeOsc.stop(now + 0.7 + idx * 0.08);
      });
    } catch {}
  }

  /**
   * Correct Answer fanfare
   */
  public playCorrect() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const now = this.ctx.currentTime;

      notes.forEach((freq, i) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);

        gain.gain.setValueAtTime(0.18, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.4);
      });
    } catch {}
  }

  /**
   * Wrong Answer tone
   */
  public playWrong() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.35);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.36);
    } catch {}
  }

  /**
   * Quest completed / Grand treasure fanfare
   */
  public playVictory() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const melody = [
        { f: 261.63, t: 0.0, d: 0.15 },
        { f: 392.0, t: 0.16, d: 0.15 },
        { f: 523.25, t: 0.32, d: 0.2 },
        { f: 659.25, t: 0.54, d: 0.2 },
        { f: 783.99, t: 0.76, d: 0.3 },
        { f: 1046.5, t: 1.1, d: 0.8 },
      ];

      melody.forEach((note) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.f, now + note.t);

        gain.gain.setValueAtTime(0.2, now + note.t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.d);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(now + note.t);
        osc.stop(now + note.t + note.d + 0.05);
      });
    } catch {}
  }

  /**
   * Footstep sound
   */
  public playStep() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90 + Math.random() * 20, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.07);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }
}

export const sounds = new SoundManager();
