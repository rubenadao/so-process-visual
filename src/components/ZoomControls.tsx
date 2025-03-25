import React from 'react';
import { ZoomControlsProps } from '../types';

const ZoomControls: React.FC<ZoomControlsProps> = ({ onZoomIn, onZoomOut, onReset }) => {
  return (
    <div className="zoom-controls">
      <button className="zoom-button" onClick={onZoomIn}>+</button>
      <button className="zoom-button" onClick={onZoomOut}>-</button>
      <button className="zoom-button" onClick={onReset}>↺</button>
    </div>
  );
};

export default ZoomControls; 