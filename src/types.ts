/**
 * SDK Status Types
 */
export type LogosStatus = 'DISCONNECTED' | 'CONNECTING' | 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/**
 * Device Roles
 */
export type DeviceRole = 'doll' | 'dev' | 'guardian';

/**
 * Persona Modes
 */
export type PersonaMode = 'child' | 'senior';

/**
 * VAD Configuration
 */
export interface VadConfig {
  /** Sensitivity 1-10, default 5 */
  sensitivity?: number;
  /** Auto calibrate background noise, default true */
  autoCalibrate?: boolean;
  /** Silence duration before concluding speech (ms), default 700 */
  timeout?: number;
}

/**
 * LogosClient Initialization Options
 */
export interface LogosClientOptions {
  /** Backend server URL */
  serverUrl: string;
  /** API Key (for commercial authentication) */
  apiKey?: string;
  /** Device ID, automatically generated if not provided */
  deviceId?: string;
  /** Device role, defaults to 'doll' */
  role?: DeviceRole;
  /** Persona mode, defaults to 'child' */
  mode?: PersonaMode;
  /** VAD configuration */
  vad?: VadConfig;
  /** Auto-reconnect, default true */
  autoReconnect?: boolean;
  /** Reconnection attempts, default 5 */
  reconnectAttempts?: number;
}

/**
 * Text Event Data
 */
export interface TextEventData {
  /** User speech (only present on first occurrence) */
  userText?: string;
  /** AI response (cumulative) */
  aiText: string;
  /** Whether the result is final */
  isFinal: boolean;
  /** Whether it is filler speech */
  isFiller?: boolean;
}

/**
 * Audio Event Data
 */
export interface AudioEventData {
  /** Text to be spoken */
  text: string;
  /** Priority (higher number means higher priority) */
  priority: number;
  /** User speech */
  userText?: string;
  /** Whether it is a guardian intercom message */
  isIntercom?: boolean;
  /** Whether it is filler speech */
  isFiller?: boolean;
}

/**
 * Settings Event Data
 */
export interface SettingsEventData {
  mode?: PersonaMode;
  vadSensitivity?: number;
  vadAutoCalibrate?: boolean;
  vadTimeout?: number;
}

/**
 * Event Type Mappings
 */
export interface LogosEvents {
  connected: () => void;
  disconnected: () => void;
  status: (status: LogosStatus) => void;
  text: (data: TextEventData) => void;
  audio: (data: AudioEventData) => void;
  settings: (data: SettingsEventData) => void;
  error: (error: Error) => void;
}
