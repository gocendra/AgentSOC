import React, { useRef, useEffect } from 'react';

const InteractiveBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let width = window.innerWidth;
    let height = window.innerHeight;
    
    let mouse = { x: width / 2, y: height / 2 };
    let targetMouse = { x: width / 2, y: height / 2 };
    
    const handleMouseMove = (e) => {
      targetMouse.x = e.clientX;
      targetMouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', resize);
    resize();

    const numStars = 600;
    const stars = [];
    
    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * width * 2 - width,
        y: Math.random() * height * 2 - height,
        z: Math.random() * width,
        pz: Math.random() * width
      });
    }

    const render = () => {
      // Background base
      ctx.fillStyle = '#0b0f19'; // Theme main color
      ctx.fillRect(0, 0, width, height);
      
      // Smooth mouse interpolation
      mouse.x += (targetMouse.x - mouse.x) * 0.05;
      mouse.y += (targetMouse.y - mouse.y) * 0.05;

      const cx = width / 2;
      const cy = height / 2;
      
      // Mouse offset
      const offsetX = (mouse.x - cx) * 0.1;
      const offsetY = (mouse.y - cy) * 0.1;

      stars.forEach(star => {
        star.z -= 3; // speed
        
        if (star.z <= 0) {
          star.x = Math.random() * width * 2 - width;
          star.y = Math.random() * height * 2 - height;
          star.z = width;
          star.pz = width;
        }

        const sx = (star.x / star.z) * (width / 2) + cx + offsetX;
        const sy = (star.y / star.z) * (height / 2) + cy + offsetY;
        
        const px = (star.x / star.pz) * (width / 2) + cx + offsetX;
        const py = (star.y / star.pz) * (height / 2) + cy + offsetY;

        star.pz = star.z;

        const opacity = 1 - (star.z / width);
        const intensity = Math.max(0.1, opacity);
        
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        // Slightly blueish-indigo stars
        ctx.strokeStyle = `rgba(165, 180, 252, ${intensity})`; 
        ctx.lineWidth = Math.max(0.5, 2 * opacity);
        ctx.stroke();
        
        // Add a tiny dot for the star itself
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.5, 1.5 * opacity), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 231, 255, ${intensity})`;
        ctx.fill();
      });

      animationFrameId = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0 pointer-events-none" />;
};

export default InteractiveBackground;
