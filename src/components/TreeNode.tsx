import React, { useEffect, useRef, useState, useCallback } from 'react';
import { TreeNodeProps, VariableInfo } from '../types';
import * as d3 from 'd3';
// @ts-ignore
import AceEditor from './AceEditor.jsx';
import './TreeNode.css';

const ANIMATION_DURATION = 750;
const RESIZE_HANDLE_SIZE = 8;
const VARS_PANEL_WIDTH = 120;

// Theme color configurations matching Ace editor themes
const themeColors: Record<string, {
  bg: string;
  text: string;
  valueColor: string;
  border: string;
}> = {
  monokai: {
    bg: '#272822',
    text: '#f8f8f2',
    valueColor: '#e6db74',
    border: '#49483e'
  },
  github: {
    bg: '#ffffff',
    text: '#24292e',
    valueColor: '#032f62',
    border: '#e1e4e8'
  },
  chrome: {
    bg: '#ffffff',
    text: '#000000',
    valueColor: '#c41a16',
    border: '#d0d0d0'
  },
  tomorrow: {
    bg: '#ffffff',
    text: '#4d4d4c',
    valueColor: '#718c00',
    border: '#d6d6d6'
  },
  twilight: {
    bg: '#141414',
    text: '#f7f7f7',
    valueColor: '#8f9d6a',
    border: '#3b3a32'
  },
  ambiance: {
    bg: '#202020',
    text: '#e6e1dc',
    valueColor: '#a5c261',
    border: '#3d3d3d'
  }
};

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
  onStepNode,
  isHorizontalLayout = false,
  currentLine = -1,
  onResize,
  editorTheme = 'monokai',
  showInlineVariables = false
}) => {
  // Debug: log each render
  console.log(`TreeNode RENDER: ${node.data.id}, node.data.currentLine=${node.data.currentLine}, prop currentLine=${currentLine}`);
  const nodeRef = useRef<SVGGElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const titleRef = useRef<SVGTextElement>(null);
  const descRef = useRef<SVGTextElement>(null);
  const [editorValue, setEditorValue] = useState(node.data.code || DEFAULT_C_PROGRAM);
  const [nodeVariables, setNodeVariables] = useState<VariableInfo[]>([]);
  const isRootNode = !node.parent;
  
  // Use node's individual currentLine if available, otherwise fall back to the global one
  const nodeCurrentLine = node.data.currentLine !== undefined ? node.data.currentLine : currentLine;
  
  // Use node's individual currentRange if available for precise highlighting
  const nodeCurrentRange = node.data.currentRange || null;
  
  // Debug: log when currentLine changes
  useEffect(() => {
    console.log(`TreeNode ${node.data.id}: nodeCurrentLine = ${nodeCurrentLine}, node.data.currentLine = ${node.data.currentLine}`);
  }, [nodeCurrentLine, node.data.currentLine, node.data.id]);
  
  // Update editor value when the node's code changes
  useEffect(() => {
    setEditorValue(node.data.code || DEFAULT_C_PROGRAM);
  }, [node.data.code]);
  
  // Create state for markers to ensure they update when the line changes
  const [lineMarkers, setLineMarkers] = useState<any[]>([]);
  
  // Update markers when the currentLine changes
  useEffect(() => {
    console.log(`TreeNode ${node.data.id}: updating markers for line ${nodeCurrentLine}`);
    // Only update markers when line actually changes
    if (nodeCurrentLine >= 0) {
      try {
        if (window.Range) {
          const newMarker = new window.Range(nodeCurrentLine, 0, nodeCurrentLine, 1);
          console.log(`TreeNode ${node.data.id}: created marker`, newMarker);
          setLineMarkers([newMarker]);
        } else {
          console.warn('window.Range not available');
          setLineMarkers([]);
        }
      } catch (e) {
        console.error('Error setting line markers:', e);
        setLineMarkers([]);
      }
    } else {
      setLineMarkers([]);
    }
  }, [nodeCurrentLine, node.data.id]);
  
  // Poll for variables when showInlineVariables is enabled
  useEffect(() => {
    if (!showInlineVariables || !node.data.isDebugging || !node.data.debuggerInstance) {
      setNodeVariables([]);
      return;
    }
    
    const updateVars = () => {
      try {
        const vars = node.data.debuggerInstance.getVariables();
        if (vars && vars.length > 0) {
          setNodeVariables(vars);
        }
      } catch (e) {
        // Silent - debugger may not be ready
      }
    };
    
    updateVars();
    const intervalId = setInterval(updateVars, 100);
    return () => clearInterval(intervalId);
  }, [showInlineVariables, node.data.isDebugging, node.data.debuggerInstance]);
  
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
        style={{ overflow: 'visible' }}
      >
        <div style={{ 
          width: '100%', 
          height: '100%',
          position: 'relative',
          zIndex: 1000,
          transform: 'none',
          transition: 'none',
          overflow: 'hidden'
        }}>
          <AceEditor
            name={`node-editor-${node.data.id}`}
            mode="c_cpp"
            theme={editorTheme}
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
            highlightLine={nodeCurrentLine}
            highlightRange={nodeCurrentRange}
            enableBasicAutocompletion={true}
            enableSnippets={false}
            enableLiveAutocompletion={true}
          />
        </div>
      </foreignObject>
      
      {/* Inline Variables Panel - to the left of the node */}
      {showInlineVariables && nodeVariables.length > 0 && (
        <foreignObject
          x={boxX - VARS_PANEL_WIDTH - 10}
          y={boxY}
          width={VARS_PANEL_WIDTH}
          height={Math.max(60, nodeVariables.length * 26 + 32)}
          style={{ overflow: 'visible' }}
        >
          <div style={{
            width: '100%',
            backgroundColor: (themeColors[editorTheme] || themeColors.monokai).bg,
            border: `1px solid ${(themeColors[editorTheme] || themeColors.monokai).border}`,
            borderRadius: '4px',
            fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace",
            fontWeight: 'bold',
            fontSize: '14px',
            boxSizing: 'border-box'
          }}>
            <div style={{
              padding: '4px 6px',
              borderBottom: `1px solid ${(themeColors[editorTheme] || themeColors.monokai).border}`,
              color: (themeColors[editorTheme] || themeColors.monokai).text,
              fontSize: '14px',
              opacity: 0.8
            }}>Vars</div>
            <div style={{ padding: '4px' }}>
              {nodeVariables.map((variable, idx) => (
                <div key={`${variable.name}-${idx}`} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '2px 0',
                  fontSize: '14px',
                  borderBottom: idx < nodeVariables.length - 1 ? `1px solid ${(themeColors[editorTheme] || themeColors.monokai).border}` : 'none'
                }}>
                  <span style={{ color: (themeColors[editorTheme] || themeColors.monokai).text }}>
                    {variable.name}
                  </span>
                  <span style={{ color: (themeColors[editorTheme] || themeColors.monokai).valueColor }}>
                    {variable.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </foreignObject>
      )}
      
      {/* PID badge - top left */}
      <g className="pid-badge">
        <rect
          x={boxX - 1}
          y={boxY - 22}
          width={40}
          height={18}
          rx={4}
          ry={4}
          fill="#2196F3"
          stroke="#1976D2"
          strokeWidth={1}
        />
        <text
          x={boxX + 19}
          y={boxY - 10}
          textAnchor="middle"
          fill="white"
          fontSize={10}
          fontWeight="bold"
          fontFamily="monospace"
          style={{ pointerEvents: 'none' }}
        >
          {node.data.name || '?'}
        </text>
      </g>

      {/* WAITING badge - shows when process is blocked on wait() */}
      {node.data.isWaiting && (
        <g className="waiting-badge">
          <rect
            x={boxX + 44}
            y={boxY - 22}
            width={58}
            height={18}
            rx={4}
            ry={4}
            fill="#FF9800"
            stroke="#F57C00"
            strokeWidth={1}
          />
          <text
            x={boxX + 73}
            y={boxY - 10}
            textAnchor="middle"
            fill="white"
            fontSize={9}
            fontWeight="bold"
            fontFamily="monospace"
            style={{ pointerEvents: 'none' }}
          >
            WAITING
          </text>
        </g>
      )}

      {/* Step button - top right */}
      {node.data.isDebugging && (
        <g
          className="step-btn"
          onClick={(e) => {
            e.stopPropagation();
            if (onStepNode) onStepNode(node.data.id);
          }}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={boxX + boxWidth - 23}
            y={boxY - 22}
            width={24}
            height={18}
            rx={4}
            ry={4}
            fill="#4CAF50"
            stroke="#388E3C"
            strokeWidth={1}
          />
          <text
            x={boxX + boxWidth - 11}
            y={boxY - 10}
            textAnchor="middle"
            fill="white"
            fontSize={11}
            fontWeight="bold"
            fontFamily="monospace"
            style={{ pointerEvents: 'none' }}
          >
            ▶
          </text>
        </g>
      )}

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