import React, { useEffect, useRef } from 'react';

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

function randomBetween(a, b) {
    return a + Math.random() * (b - a);
}

/**
 * ConfettiCelebration
 * Renders a canvas overlay with a one-shot confetti burst.
 * Props:
 *   active  — boolean, set to true to trigger
 *   onDone  — callback fired when animation ends (~3 s)
 */
export default function ConfettiCelebration({ active, onDone }) {
    const canvasRef = useRef(null);
    const animRef   = useRef(null);

    useEffect(() => {
        if (!active) return;

        const canvas  = canvasRef.current;
        if (!canvas) return;
        const ctx     = canvas.getContext('2d');
        const W       = canvas.width  = window.innerWidth;
        const H       = canvas.height = window.innerHeight;

        // Create particles
        const particles = Array.from({ length: 80 }, () => ({
            x:     randomBetween(W * 0.2, W * 0.8),
            y:     randomBetween(-20, -5),
            vx:    randomBetween(-3, 3),
            vy:    randomBetween(2, 7),
            size:  randomBetween(7, 14),
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            angle: randomBetween(0, Math.PI * 2),
            spin:  randomBetween(-0.15, 0.15),
            alpha: 1,
        }));

        let start = null;
        const DURATION = 3000; // ms

        function draw(ts) {
            if (!start) start = ts;
            const elapsed = ts - start;
            ctx.clearRect(0, 0, W, H);

            particles.forEach((p) => {
                p.x     += p.vx;
                p.y     += p.vy;
                p.vy    += 0.12; // gravity
                p.angle += p.spin;
                p.alpha  = Math.max(0, 1 - elapsed / DURATION);

                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                ctx.restore();
            });

            if (elapsed < DURATION) {
                animRef.current = requestAnimationFrame(draw);
            } else {
                ctx.clearRect(0, 0, W, H);
                onDone?.();
            }
        }

        animRef.current = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animRef.current);
        };
    }, [active, onDone]);

    if (!active) return null;

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 9999,
            }}
        />
    );
}
