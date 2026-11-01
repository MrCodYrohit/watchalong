/**
 * Virtual Camera Generator
 * Creates an animated video track from an HTML5 canvas.
 * Useful when physical webcam is locked by another tab on the same machine
 * (e.g. testing multi-user on a single computer) or when webcam hardware is unavailable.
 */

export function createVirtualCameraTrack(displayName: string, avatar: string = '🍿'): MediaStreamTrack | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let frame = 0;
    let isRunning = true;

    const render = () => {
      if (!isRunning) return;
      frame++;

      // Gradient background
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#09090b');
      grad.addColorStop(0.5, '#18181b');
      grad.addColorStop(1, '#09090b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle dynamic glow ring
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2 - 20;
      const pulse = Math.sin(frame * 0.05) * 8;

      ctx.beginPath();
      ctx.arc(centerX, centerY, 56 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
      ctx.fill();

      // Avatar circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, 48, 0, Math.PI * 2);
      ctx.fillStyle = '#27272a';
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 3;
      ctx.fill();
      ctx.stroke();

      // Avatar Emoji
      ctx.font = '40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(avatar, centerX, centerY);

      // Display Name
      ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#f4f4f5';
      ctx.fillText(displayName, centerX, centerY + 80);

      // Animated Soundwave bars at bottom of canvas
      const barCount = 18;
      const barWidth = 6;
      const barSpacing = 6;
      const totalWidth = barCount * (barWidth + barSpacing);
      const startX = centerX - totalWidth / 2;

      for (let i = 0; i < barCount; i++) {
        const h = Math.abs(Math.sin((frame * 0.08) + i * 0.4)) * 26 + 4;
        const x = startX + i * (barWidth + barSpacing);
        const y = centerY + 115 - h / 2;
        ctx.fillStyle = i % 2 === 0 ? '#ef4444' : '#f43f5e';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, 3);
        ctx.fill();
      }

      // Badge: Test Camera Feed
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 1;
      const badgeY = 24;
      ctx.beginPath();
      ctx.roundRect(centerX - 90, badgeY, 180, 26, 13);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX - 68, badgeY + 13, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();

      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#a7f3d0';
      ctx.textAlign = 'left';
      ctx.fillText('LIVE TEST FEED ACTIVE', centerX - 56, badgeY + 14);

      requestAnimationFrame(render);
    };

    render();

    // Capture at 20 FPS for smooth WebRTC transmission
    const stream = canvas.captureStream(20);
    const track = stream.getVideoTracks()[0];

    // Clean up animation loop when track stops
    if (track) {
      const originalStop = track.stop.bind(track);
      track.stop = () => {
        isRunning = false;
        originalStop();
      };
    }

    return track || null;
  } catch (err) {
    console.warn('[VirtualCam] Could not create virtual camera track:', err);
    return null;
  }
}
