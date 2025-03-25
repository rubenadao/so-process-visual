import React from 'react';
import { TreeLinkProps } from '../types';

interface ExtendedTreeLinkProps extends TreeLinkProps {
  sourceX?: number;
  sourceY?: number;
  targetX?: number;
  targetY?: number;
  isHorizontalLayout?: boolean;
}

const TreeLink: React.FC<ExtendedTreeLinkProps> = ({ 
  link, 
  sourceX, 
  sourceY, 
  targetX, 
  targetY,
  isHorizontalLayout = false 
}) => {
  // If source/target coordinates are provided, use them; otherwise fallback to link data
  const source = {
    x: sourceX !== undefined ? sourceX : (typeof link.source.x === 'number' ? link.source.x : 0),
    y: sourceY !== undefined ? sourceY : (typeof link.source.y === 'number' ? link.source.y : 0)
  };
  
  const target = {
    x: targetX !== undefined ? targetX : (typeof link.target.x === 'number' ? link.target.x : 0),
    y: targetY !== undefined ? targetY : (typeof link.target.y === 'number' ? link.target.y : 0)
  };

  // Calculate the path
  let path;
  
  if (isHorizontalLayout) {
    // For horizontal layout, start from source, move halfway to target on x-axis,
    // then go straight up/down to the target y-coordinate, then finish to target
    const midX = source.x + (target.x - source.x) / 2;
    
    path = `
      M ${source.x},${source.y}
      L ${midX},${source.y}
      L ${midX},${target.y}
      L ${target.x},${target.y}
    `;
  } else {
    // For vertical layout, start from source, move halfway to target on y-axis,
    // then go straight left/right to the target x-coordinate, then finish to target
    const midY = source.y + (target.y - source.y) / 2;
    
    path = `
      M ${source.x},${source.y}
      L ${source.x},${midY}
      L ${target.x},${midY}
      L ${target.x},${target.y}
    `;
  }

  return (
    <>
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#000" />
        </marker>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="#000"
        strokeWidth="1.5"
        strokeOpacity="0.8"
        strokeLinecap="round"
        className="tree-link"
        markerEnd="url(#arrowhead)"
        style={{
          transition: 'all 750ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
    </>
  );
};

export default TreeLink; 