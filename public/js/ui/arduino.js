/**
 * 아두이노 Uno 시리얼 연결 (Web Serial API, PC의 Chrome·Edge 전용).
 *
 * 아두이노는 9600 bps로 `T:18.5,N:42` 형식의 줄을 보냅니다.
 * Web Serial은 HTTPS 또는 localhost에서만 동작합니다 (Firebase Hosting은 HTTPS라 OK).
 */
const BAUD_RATE = 9600;
const LINE_PATTERN = /T:(-?\d+(?:\.\d+)?),N:(\d+)/;

/**
 * 한 줄을 해석. 수온 센서가 빠져 있으면 DS18B20이 -127을 보내므로 temp는 null.
 * @returns {{temp: number|null, noise: number, raw: string} | null}
 */
export function parseSensorLine(line) {
  const m = LINE_PATTERN.exec(line);
  if (!m) return null;
  const t = parseFloat(m[1]);
  return {
    temp: t > -50 && t < 60 ? t : null,
    noise: Math.min(100, parseInt(m[2], 10)),
    raw: line.trim(),
  };
}

export class ArduinoLink {
  /**
   * @param {Object} handlers
   * @param {(reading: {temp: number|null, noise: number, raw: string}) => void} handlers.onReading
   * @param {(text: string, kind?: 'on'|'err') => void} handlers.onStatus
   * @param {(connected: boolean) => void} handlers.onConnectionChange
   */
  constructor({ onReading, onStatus, onConnectionChange }) {
    this.onReading = onReading;
    this.onStatus = onStatus;
    this.onConnectionChange = onConnectionChange;
    this._port = null;
    this._reader = null;
  }

  static get supported() {
    return 'serial' in navigator;
  }

  get connected() {
    return this._port !== null;
  }

  async connect() {
    if (!ArduinoLink.supported) {
      this.onStatus('이 브라우저는 USB 시리얼 연결을 지원하지 않습니다. PC의 Chrome 또는 Edge에서 여세요.', 'err');
      return;
    }
    try {
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: BAUD_RATE });
    } catch (e) {
      this._port = null;
      this.onStatus(
        e && e.name === 'NotFoundError' ? '포트를 고르지 않았습니다.' : '연결하지 못했습니다. 시리얼 모니터가 열려 있으면 닫아 주세요.',
        'err',
      );
      return;
    }

    this.onConnectionChange(true);
    this.onStatus('연결됨 · 데이터를 기다리는 중', 'on');
    await this._readLoop();
  }

  /** 읽기를 멈추면 _readLoop의 finally에서 포트를 닫음 */
  async disconnect() {
    if (this._reader) {
      try { await this._reader.cancel(); } catch { /* 이미 닫힘 */ }
    }
  }

  async _readLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    let lost = false;
    this._reader = this._port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this._reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const reading = parseSensorLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          if (reading) this.onReading(reading);
        }
      }
    } catch {
      lost = true; // USB가 뽑히는 등
    } finally {
      try { this._reader.releaseLock(); } catch { /* 무시 */ }
      try { await this._port.close(); } catch { /* 무시 */ }
      this._reader = null;
      this._port = null;
      this.onConnectionChange(false);
      if (lost) this.onStatus('연결이 끊겼습니다.', 'err');
    }
  }
}
