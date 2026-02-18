export interface CameraTarget {
  x: number;
  y: number;
}

export class CameraController {
  public x = 0;
  public y = 0;
  public zoom = 1;

  private targetX = 0;
  private targetY = 0;
  private smoothing = 0.2;

  setTarget(target: CameraTarget) {
    this.targetX = target.x;
    this.targetY = target.y;
  }

  setSmoothing(value: number) {
    this.smoothing = Math.max(0.01, Math.min(1, value));
  }

  update() {
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;

    // Pixel-perfect snap for 16-bit look.
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
  }
}
