import React, { useState, useEffect } from 'react';

function Toast({ message }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    const fadeOut = setTimeout(() => setVisible(false), 2600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fadeOut);
    };
  }, []);

  return (
    <div className={`toast${visible ? ' toast--visible' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export default Toast;
