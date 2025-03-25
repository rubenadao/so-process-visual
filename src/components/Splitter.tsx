import React, { useCallback, useEffect, useState } from 'react';

interface SplitterProps {
  onResize: (newWidth: number) => void;
}

const Splitter: React.FC<SplitterProps> = ({ onResize }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    const newWidth = e.clientX;
    
    // Make sure the width is within reasonable bounds
    if (newWidth >= 350 && newWidth <= 800) {
      onResize(newWidth);
    }
  }, [isDragging, onResize]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div 
      className={`splitter ${isDragging ? 'active' : ''}`}
      onMouseDown={handleMouseDown}
    />
  );
};

export default Splitter; 