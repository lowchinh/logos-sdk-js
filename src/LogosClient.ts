import { io, Socket } from 'socket.io-client';
import type {
  LogosClientOptions,
  LogosStatus,
  LogosEvents,
  VadConfig,
  DeviceRole,
  PersonaMode,
  TextEventData,
  AudioEventData,
  SettingsEventData,
} from './types';

/**
 * LogosClient SDK
 * 
 * Encapulates WebSocket communication with Logos backend, voice recording, and VAD logic.
 * 
 * @example
 * ```typescript
 * const client = new LogosClient({
 *   serverUrl: 'http://localhost:8000',
 *   apiKey: 'sk-xxx',
 *   mode: 'child',
 * });
 * 
 * client.on('text', ({ aiText }) => console.log(aiText));
 * client.on('audio', ({ text }) => speak(text));
 * 
 * client.connect();
 * client.startListening();
 * ```
 */
export class LogosClient {
  // Configuration
  private serverUrl: string;
  private apiKey?: string;
  private deviceId: string;
  private role: DeviceRole;
  private mode: PersonaMode;
  private vadConfig: Required<VadConfig>;
  private autoReconnect: boolean;
  private reconnectAttempts: number;

  // State
  private _status: LogosStatus = 'DISCONNECTED';
  private socket: Socket | null = null;
  private calibratedNoiseFloor: number | null = null;

  // Audio
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private silenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private voiceDetected = false;
  private recordingStartTime = 0;
  private vadIntervalId: ReturnType<typeof setInterval> | null = null;

  // Constants
  private readonly MIN_SPEECH_DURATION = 400;

  // Event handlers
  private eventHandlers: Partial<{ [K in keyof LogosEvents]: LogosEvents[K][] }> = {};

  constructor(options: LogosClientOptions) {
    this.serverUrl = options.serverUrl;
    this.apiKey = options.apiKey;
    this.deviceId = options.deviceId || this.generateDeviceId();
    this.role = options.role || 'doll';
    this.mode = options.mode || 'child';
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectAttempts = options.reconnectAttempts ?? 5;

    this.vadConfig = {
      sensitivity: options.vad?.sensitivity ?? 5,
      autoCalibrate: options.vad?.autoCalibrate ?? true,
      timeout: options.vad?.timeout ?? 700,
    };
  }

  // ========== Public API ==========

  /** Current Status */
  get status(): LogosStatus {
    return this._status;
  }

  /** Current Mode */
  get currentMode(): PersonaMode {
    return this.mode;
  }

  /** Whether connected */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Register event listener */
  on<K extends keyof LogosEvents>(event: K, handler: LogosEvents[K]): void {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event]!.push(handler);
  }

  /** Remove event listener */
  off<K extends keyof LogosEvents>(event: K, handler: LogosEvents[K]): void {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) handlers.splice(index, 1);
    }
  }

  /** Connect to server */
  connect(): void {
    if (this.socket?.connected) {
      console.warn('[LogosClient] Already connected');
      return;
    }

    this.setStatus('CONNECTING');

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: this.autoReconnect,
      reconnectionAttempts: this.reconnectAttempts,
      reconnectionDelay: 1000,
      auth: this.apiKey ? { apiKey: this.apiKey } : undefined,
    });

    this.setupSocketListeners();
  }

  /** Disconnect from server */
  disconnect(): void {
    this.stopListening();
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('DISCONNECTED');
  }

  /** Start voice listening */
  async startListening(): Promise<void> {
    if (!this.socket?.connected) {
      console.warn('[LogosClient] Cannot start listening: not connected');
      return;
    }

    if (this._status === 'LISTENING') {
      console.warn('[LogosClient] Already listening');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaStream = stream;

      // Setup AudioContext for VAD
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);
      this.analyser.fftSize = 256;

      // Reset VAD state
      this.voiceDetected = false;
      this.recordingStartTime = 0;

      // Setup MediaRecorder
      const mimeType = this.getSupportedMimeType();
      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => this.handleRecordingStop();

      this.mediaRecorder.start();
      this.setStatus('LISTENING');

      // Start VAD loop
      this.vadIntervalId = setInterval(() => {
        if (this.mediaRecorder?.state === 'recording') {
          this.detectVoiceActivity();
        }
      }, 100);

    } catch (err) {
      console.error('[LogosClient] Microphone error:', err);
      this.emit('error', new Error('Microphone access denied'));
      this.setStatus('IDLE');
    }
  }

  /** Stop voice listening */
  stopListening(): void {
    if (this.vadIntervalId) {
      clearInterval(this.vadIntervalId);
      this.vadIntervalId = null;
    }

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  /** Send text message */
  sendText(text: string): void {
    if (!this.socket?.connected) {
      console.warn('[LogosClient] Cannot send text: not connected');
      return;
    }

    this.socket.emit('text_input', { text, mode: this.mode });
  }

  /** Update settings */
  updateSettings(settings: Partial<SettingsEventData>): void {
    if (settings.mode) this.mode = settings.mode;
    if (settings.vadSensitivity !== undefined) this.vadConfig.sensitivity = settings.vadSensitivity;
    if (settings.vadAutoCalibrate !== undefined) this.vadConfig.autoCalibrate = settings.vadAutoCalibrate;
    if (settings.vadTimeout !== undefined) this.vadConfig.timeout = settings.vadTimeout;
  }

  // ========== Private Methods ==========

  private setStatus(status: LogosStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status', status);
    }
  }

  private emit<K extends keyof LogosEvents>(event: K, ...args: Parameters<LogosEvents[K]>): void {
    const handlers = this.eventHandlers[event] as ((...args: Parameters<LogosEvents[K]>) => void)[] | undefined;
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  private generateDeviceId(): string {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('logos_device_id') : null;
    if (stored) return stored;

    const newId = `logos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('logos_device_id', newId);
    }
    return newId;
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('[LogosClient] Connected:', this.socket?.id);

      // Handshake
      this.socket?.emit('handshake', {
        role: this.role,
        deviceId: this.deviceId,
      });

      this.setStatus('IDLE');
      this.emit('connected');
    });

    this.socket.on('disconnect', () => {
      console.log('[LogosClient] Disconnected');
      this.setStatus('DISCONNECTED');
      this.emit('disconnected');
    });

    this.socket.on('status', (data: { status: string }) => {
      if (data.status === 'thinking') this.setStatus('THINKING');
      else if (data.status === 'idle') this.setStatus('IDLE');
    });

    this.socket.on('set_settings', (data: SettingsEventData) => {
      this.updateSettings(data);
      this.emit('settings', data);
    });

    this.socket.on('live_text', (data: { role: string; text: string; isFinal: boolean; userText?: string; isFiller?: boolean }) => {
      if (data.role === 'ai') {
        const textData: TextEventData = {
          userText: data.userText,
          aiText: data.text,
          isFinal: data.isFinal,
          isFiller: data.isFiller,
        };
        this.emit('text', textData);
      }
    });

    this.socket.on('audio_output', (data: { text: string; priority: number; userText?: string; isIntercom?: boolean; isFiller?: boolean }) => {
      const audioData: AudioEventData = {
        text: data.text,
        priority: data.priority,
        userText: data.userText,
        isIntercom: data.isIntercom,
        isFiller: data.isFiller,
      };
      this.emit('audio', audioData);
    });

    this.socket.on('error', (data: { message: string }) => {
      console.error('[LogosClient] Server error:', data.message);
      this.emit('error', new Error(data.message));
    });

    // Auth error - specific authentication failure
    this.socket.on('auth_error', (data: { code: string; message: string }) => {
      console.error('[LogosClient] Auth error:', data.code, data.message);
      this.setStatus('DISCONNECTED');
      this.emit('error', new Error(`Auth failed: ${data.message} (${data.code})`));
    });

    this.socket.on('connect_error', (err: Error) => {
      console.error('[LogosClient] Connection error:', err.message);
      this.setStatus('DISCONNECTED');
      this.emit('error', err);
    });
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
      'audio/wav',
    ];
    return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  private getVadThresholds(): { silenceThreshold: number; voiceThreshold: number } {
    const sensitivity = this.vadConfig.sensitivity;

    if (!this.vadConfig.autoCalibrate) {
      const baseThreshold = Math.max(5, 35 - (sensitivity * 3));
      return {
        silenceThreshold: baseThreshold,
        voiceThreshold: baseThreshold + 5,
      };
    }

    const noiseFloor = this.calibratedNoiseFloor ?? 10;
    const margin = 15;
    return {
      silenceThreshold: noiseFloor + margin,
      voiceThreshold: noiseFloor + margin + 5,
    };
  }

  private detectVoiceActivity(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const { silenceThreshold, voiceThreshold } = this.getVadThresholds();

    if (average > voiceThreshold) {
      if (!this.voiceDetected) {
        console.log('[LogosClient] Voice detected');
        this.voiceDetected = true;
        this.recordingStartTime = Date.now();
      }
      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
    }

    if (average < silenceThreshold && this.voiceDetected) {
      if (!this.silenceTimeout) {
        this.silenceTimeout = setTimeout(() => {
          const speechDuration = Date.now() - this.recordingStartTime;
          console.log(`[LogosClient] Silence detected. Duration: ${speechDuration}ms`);

          if (speechDuration >= this.MIN_SPEECH_DURATION) {
            this.stopListening();
          } else {
            this.voiceDetected = false;
            this.silenceTimeout = null;
          }
        }, this.vadConfig.timeout);
      }
    }
  }

  private async handleRecordingStop(): Promise<void> {
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
    const audioBlob = new Blob(this.audioChunks, { type: mimeType });
    const speechDuration = Date.now() - this.recordingStartTime;

    if (this.voiceDetected && audioBlob.size > 2000 && speechDuration >= this.MIN_SPEECH_DURATION) {
      console.log(`[LogosClient] Sending audio: ${audioBlob.size} bytes`);
      this.setStatus('THINKING');

      const arrayBuffer = await audioBlob.arrayBuffer();
      this.socket?.emit('audio_input', {
        audio: arrayBuffer,
        mimeType: mimeType,
        mode: this.mode,
      });
    } else {
      console.log('[LogosClient] No valid speech, resuming');
      this.setStatus('IDLE');
      // Auto-restart listening after a brief pause
      setTimeout(() => this.startListening(), 500);
    }
  }
}
