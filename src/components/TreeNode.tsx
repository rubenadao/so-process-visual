import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TreeNodeProps } from '../types';
import * as d3 from 'd3';
// @ts-ignore
import AceEditor from './AceEditor.jsx';
import './TreeNode.css';

const ANIMATION_DURATION = 750;
const RESIZE_HANDLE_SIZE = 8;

// Simple C program template
const DEFAULT_C_PROGRAM = `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    
    int number = 42;
    printf("The answer is: %d\\n", number);
    
    return 0;
}`;

const TreeNode: React.FC<TreeNodeProps> = ({ 
  node, 
  boxWidth, 
  boxHeight, 
  onClick, 
  isHorizontalLayout = false,
  currentLine = -1,
  onResize
}) => {
  const nodeRef = useRef<SVGGElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const titleRef = useRef<SVGTextElement>(null);
  const descRef = useRef<SVGTextElement>(null);
  const [editorValue, setEditorValue] = useState(node.data.code || DEFAULT_C_PROGRAM);
  const isRootNode = !node.parent;
  
  // Use node's individual currentLine if available, otherwise fall back to the global one
  const nodeCurrentLine = node.data.currentLine !== undefined ? node.data.currentLine : currentLine;
  
  // Update editor value when the node's code changes
  useEffect(() => {
    setEditorValue(node.data.code || DEFAULT_C_PROGRAM);
  }, [node.data.code]);
  
  // Create state for markers to ensure they update when the line changes
  const [lineMarkers, setLineMarkers] = useState<any[]>([]);
  
  // Update markers when the currentLine changes
  useEffect(() => {
    // Only update markers when line actually changes
    if (nodeCurrentLine >= 0) {
      try {
        setLineMarkers([new window.Range(nodeCurrentLine, 0, nodeCurrentLine, 1)]);
      } catch (e) {
        console.error('Error setting line markers:', e);
        setLineMarkers([]);
      }
    } else {
      setLineMarkers([]);
    }
  }, [nodeCurrentLine]);
  
  // Resizing state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState('');
  const [startCoords, setStartCoords] = useState({ x: 0, y: 0 });
  const [startDimensions, setStartDimensions] = useState({ width: 0, height: 0 });

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.stopPropagation(); // Prevent node click event
    e.preventDefault(); // Prevent default behavior
    
    setIsResizing(true);
    setResizeDirection(direction);
    setStartCoords({ x: e.clientX, y: e.clientY });
    setStartDimensions({ width: boxWidth, height: boxHeight });
    
    // Add event listeners globally - handled in useEffect
  }, [boxWidth, boxHeight]);

  // Handle resize move - defined outside but attached conditionally
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const deltaX = e.clientX - startCoords.x;
    const deltaY = e.clientY - startCoords.y;
    
    let newWidth = startDimensions.width;
    let newHeight = startDimensions.height;
    
    // Calculate new dimensions based on resize direction
    switch (resizeDirection) {
      case 'se': // southeast
        newWidth = Math.max(100, startDimensions.width + deltaX);
        newHeight = Math.max(80, startDimensions.height + deltaY);
        break;
      case 'sw': // southwest
        newWidth = Math.max(100, startDimensions.width - deltaX);
        newHeight = Math.max(80, startDimensions.height + deltaY);
        break;
      case 'ne': // northeast
        newWidth = Math.max(100, startDimensions.width + deltaX);
        newHeight = Math.max(80, startDimensions.height - deltaY);
        break;
      case 'nw': // northwest
        newWidth = Math.max(100, startDimensions.width - deltaX);
        newHeight = Math.max(80, startDimensions.height - deltaY);
        break;
    }
    
    // Keep dimensions within bounds
    newWidth = Math.min(newWidth, 500);
    newHeight = Math.min(newHeight, 500);
    
    if (onResize) {
      onResize(Math.round(newWidth), Math.round(newHeight));
    }
  }, [isResizing, resizeDirection, startCoords, startDimensions, onResize]);

  // Handle resize end
  const handleResizeEnd = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(false);
    // Event listeners removal handled in useEffect
  }, []);

  // Attach and detach event listeners based on resizing state
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
    } else {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    }

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  useEffect(() => {
    if (!nodeRef.current) return;

    // Animate node container
    d3.select(rectRef.current)
      .style('opacity', 0)
      .transition()
      .duration(ANIMATION_DURATION)
      .style('opacity', 1);

    // Only animate title and description for non-root nodes
    if (!isRootNode) {
      // Animate title with delay
      d3.select(titleRef.current)
        .style('opacity', 0)
        .transition()
        .delay(ANIMATION_DURATION * 0.3)
        .duration(ANIMATION_DURATION * 0.7)
        .style('opacity', 1);

      // Animate description with more delay
      if (descRef.current) {
        d3.select(descRef.current)
          .style('opacity', 0)
          .transition()
          .delay(ANIMATION_DURATION * 0.5)
          .duration(ANIMATION_DURATION * 0.7)
          .style('opacity', 1);
      }
    }
  }, [isRootNode]);

  const handleClick = () => {
    if (onClick) {
      onClick(node.data);
    }
  };

  // Editor is read-only, but keeping this as a placeholder in case we need to handle any editor events
  const handleEditorChange = (value: string) => {
    // Not updating editorValue since the editor is read-only
    // setEditorValue(value);
    // if (onClick) {
    //   // Update the node's code in the tree data
    //   onClick({
    //     ...node.data,
    //     code: value
    //   });
    // }
  };

  // Use the state-based markers instead of creating them inline
  const markers = lineMarkers;

  // Calculate base coordinates for the box
  const boxX = isHorizontalLayout ? 0 : -boxWidth / 2;
  const boxY = isHorizontalLayout ? -boxHeight / 2 : 0;

  // Create resize handles positions
  const handles = [
    { 
      id: 'nw', 
      x: boxX - RESIZE_HANDLE_SIZE / 2, 
      y: boxY - RESIZE_HANDLE_SIZE / 2,
      cursor: 'nwse-resize'
    },
    { 
      id: 'ne', 
      x: boxX + boxWidth - RESIZE_HANDLE_SIZE / 2, 
      y: boxY - RESIZE_HANDLE_SIZE / 2,
      cursor: 'nesw-resize'
    },
    { 
      id: 'sw', 
      x: boxX - RESIZE_HANDLE_SIZE / 2, 
      y: boxY + boxHeight - RESIZE_HANDLE_SIZE / 2,
      cursor: 'nesw-resize'
    },
    { 
      id: 'se', 
      x: boxX + boxWidth - RESIZE_HANDLE_SIZE / 2, 
      y: boxY + boxHeight - RESIZE_HANDLE_SIZE / 2,
      cursor: 'nwse-resize'
    }
  ];

  return (
    <g
      ref={nodeRef}
      className="node"
      onClick={handleClick}
    >
      <rect
        ref={rectRef}
        className="node-container"
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx={4}
        ry={4}
      />
      
      <foreignObject
        x={boxX + 2}
        y={boxY + 2}
        width={boxWidth - 4}
        height={boxHeight - 4}
        style={{ overflow: 'hidden' }}
      >
        <div style={{ 
          width: '100%', 
          height: '100%',
          position: 'relative',
          zIndex: 1000,
          transform: 'none',
          transition: 'none'
        }}>
          <AceEditor
            name={`node-editor-${node.data.id}`}
            mode="c_cpp"
            theme="monokai"
            value={editorValue}
            onChange={handleEditorChange}
            fontSize={12}
            width="100%"
            height="100%"
            showGutter={true}
            highlightActiveLine={false}
            showPrintMargin={false}
            readOnly={true}
            maxLines={Infinity}
            markers={markers}
            enableBasicAutocompletion={true}
            enableSnippets={false}
            enableLiveAutocompletion={true}
          />
        </div>
      </foreignObject>
      
      {/* Resize handles */}
      {handles.map(handle => (
        <rect
          key={handle.id}
          className={`resize-handle ${handle.id}`}
          x={handle.x}
          y={handle.y}
          width={RESIZE_HANDLE_SIZE}
          height={RESIZE_HANDLE_SIZE}
          style={{ cursor: handle.cursor }}
          onMouseDown={(e) => handleResizeStart(e, handle.id)}
        />
      ))}
    </g>
  );
};

export default TreeNode; 