/**
 * Zaman kaydırıcısının oynatma durumu. Saf mantık — çizim ve DOM main.ts'te.
 * Zaman aralığının tamamı `sweepSeconds` saniyede oynatılır.
 */
export class Timeline {
  start = 0;
  end = 0;
  cursor = 0;
  playing = false;
  sweepSeconds = 20;

  get span(): number {
    return Math.max(0, this.end - this.start);
  }

  /** 0..1 arası konum */
  get fraction(): number {
    return this.span === 0 ? 1 : (this.cursor - this.start) / this.span;
  }

  get atEnd(): boolean {
    return this.cursor >= this.end;
  }

  /** Aralığı günceller; imleci yeni aralığın içinde tutar */
  setRange(start: number, end: number) {
    this.start = start;
    this.end = Math.max(start, end);
    this.cursor = Math.min(this.end, Math.max(this.start, this.cursor));
  }

  seek(fraction: number) {
    const f = Math.min(1, Math.max(0, fraction));
    this.cursor = this.start + f * this.span;
  }

  play() {
    // sona gelmişse baştan başlat
    if (this.atEnd) this.cursor = this.start;
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** dtSec kadar gerçek zaman geçti; oynatılıyorsa imleci ilerletir, sona gelince durur */
  step(dtSec: number) {
    if (!this.playing || this.span === 0) return;
    this.cursor += (this.span / this.sweepSeconds) * dtSec;
    if (this.cursor >= this.end) {
      this.cursor = this.end;
      this.playing = false;
    }
  }
}
