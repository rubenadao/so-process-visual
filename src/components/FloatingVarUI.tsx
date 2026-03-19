import React, { useState, useEffect, useRef, useCallback } from 'react';
import './FloatingVarUI.css';
import { TreeNode, VariableInfo } from '../types';

interface FloatingVarUIProps {
  isDebugging: boolean;
  debuggerRef?: React.RefObject<any>;
  data?: TreeNode | null; // Allow null when no tree exists yet
  editorTheme?: string;
}

// Theme color configurations matching Ace editor themes
const themeColors: Record<string, {
  bg: string;
  headerBg: string;
  headerText: string;
  text: string;
  textSecondary: string;
  valueColor: string;
  border: string;
  buttonBorder: string;
}> = {
  monokai: {
    bg: '#272822',
    headerBg: '#3e3d32',
    headerText: '#f8f8f2',
    text: '#f8f8f2',
    textSecondary: '#a6e22e',
    valueColor: '#e6db74',
    border: '#49483e',
    buttonBorder: '#75715e'
  },
  github: {
    bg: '#ffffff',
    headerBg: '#f6f8fa',
    headerText: '#24292e',
    text: '#24292e',
    textSecondary: '#005cc5',
    valueColor: '#032f62',
    border: '#e1e4e8',
    buttonBorder: '#c8c8c8'
  },
  chrome: {
    bg: '#ffffff',
    headerBg: '#f0f0f0',
    headerText: '#000000',
    text: '#000000',
    textSecondary: '#1a1aa6',
    valueColor: '#c41a16',
    border: '#d0d0d0',
    buttonBorder: '#999999'
  },
  tomorrow: {
    bg: '#ffffff',
    headerBg: '#efefef',
    headerText: '#4d4d4c',
    text: '#4d4d4c',
    textSecondary: '#8959a8',
    valueColor: '#718c00',
    border: '#d6d6d6',
    buttonBorder: '#999999'
  },
  twilight: {
    bg: '#141414',
    headerBg: '#1f1f1f',
    headerText: '#f7f7f7',
    text: '#f7f7f7',
    textSecondary: '#cda869',
    valueColor: '#8f9d6a',
    border: '#3b3a32',
    buttonBorder: '#555555'
  },
  ambiance: {
    bg: '#202020',
    headerBg: '#2d2d2d',
    headerText: '#e6e1dc',
    text: '#e6e1dc',
    textSecondary: '#e6db74',
    valueColor: '#a5c261',
    border: '#3d3d3d',
    buttonBorder: '#666666'
  }
};

const FloatingVarUI: React.FC<FloatingVarUIProps> = ({ isDebugging, debuggerRef, data, editorTheme = 'monokai' }) => {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: 70 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const floatingPanelRef = useRef<HTMLDivElement>(null);

  // Function to collect variables from all debugger instances
  const updateVariablesFromTree = (node: TreeNode, ancestors: TreeNode[] = []): VariableInfo[] => {
    // Initialize with an empty array
    let allVariables: VariableInfo[] = [];
    
    // Only process nodes that are currently debugging and have a debugger instance
    if (node.isDebugging && node.debuggerInstance) {
      try {
        // Get variables from this node
        const nodeVars = node.debuggerInstance.getVariables();
        
        // Create a path string showing the node hierarchy for display
        const nodePath = ancestors.length > 0 
          ? `${ancestors.map(a => a.name || a.id.slice(0, 6)).join(' > ')} > ${node.name || node.id.slice(0, 6)}`
          : (node.name || node.id.slice(0, 6));
        
        // Add node context to each variable and add to our result array
        if (nodeVars && nodeVars.length > 0) {
          const processedVars = nodeVars.map(v => ({
            ...v,
            nodeId: node.id,
            nodeName: node.name || node.id.slice(0, 6),
            nodePath
          }));
          
          allVariables = [...allVariables, ...processedVars];
        }
      } catch (error) {
        // Silent error - no console logs
      }
    }
    
    // Process child nodes recursively if they exist
    if (node.children && node.children.length > 0) {
      // Add this node to ancestors for child processing
      const newAncestors = [...ancestors, node];
      
      // Process each child and collect their variables
      node.children.forEach(childNode => {
        const childVars = updateVariablesFromTree(childNode, newAncestors);
        if (childVars.length > 0) {
          allVariables = [...allVariables, ...childVars];
        }
      });
    }
    
    return allVariables;
  };

  // Set up variable polling when debugging
  useEffect(() => {
    // Only set up polling if the tree data exists and we're debugging
    if (!data || !isDebugging) return;
    
    // Set up polling interval to refresh variables
    const intervalId = setInterval(() => {
      // Get all variables from the tree
      const newVariables = updateVariablesFromTree(data);
      
      // Update state with the new variables
      if (newVariables.length > 0) {
        setVariables(newVariables);
      }
    }, 100); // Poll every 100ms for more responsive updates
    
    // Clean up on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [data, isDebugging]);

  // Start dragging the window
  const handleMouseDown = (e: React.MouseEvent) => {
    // Check if clicking on the drag handle (header bar)
    const target = e.target as HTMLElement;
    const dragHandle = floatingPanelRef.current?.querySelector('.drag-handle');
    if (dragHandle && (target === dragHandle || dragHandle.contains(target))) {
      // Don't start drag if clicking on buttons
      if (target.tagName === 'BUTTON') return;
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX - position.x, 
        y: e.clientY - position.y 
      });
      e.preventDefault();
    }
  };

  // Update position while dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      // Allow dragging to any position, but keep at least 50px visible on screen
      const newX = Math.max(-250, Math.min(window.innerWidth - 50, e.clientX - dragStart.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragStart.y));
      setPosition({ x: newX, y: newY });
    }
  }, [isDragging, dragStart]);

  // Stop dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Attach and detach global event listeners for dragging
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

  if (!isDebugging) {
    return null;
  }

  // Check if there are any variables to display
  const hasVariables = variables.length > 0;

  // Group variables by node
  const variablesByNode: Record<string, VariableInfo[]> = {};
  variables.forEach(v => {
    const nodeId = v.nodeId || 'unknown-node';
    if (!variablesByNode[nodeId]) {
      variablesByNode[nodeId] = [];
    }
    variablesByNode[nodeId].push(v);
  });

  // Get theme colors
  const colors = themeColors[editorTheme] || themeColors.monokai;
  const isLightTheme = ['github', 'chrome', 'tomorrow'].includes(editorTheme);

  return (
    <div 
      className="floating-var-ui" 
      ref={floatingPanelRef}
      style={{ 
        position: 'fixed',
        top: `${position.y}px`, 
        left: `${position.x}px`,
        width: '300px',
        height: isCollapsed ? '40px' : 'auto',
        maxHeight: '80vh',
        backgroundColor: colors.bg,
        boxShadow: isLightTheme ? '0 4px 12px rgba(0, 0, 0, 0.15)' : '0 4px 10px rgba(0, 0, 0, 0.3)',
        borderRadius: '4px',
        overflow: 'hidden',
        zIndex: 9999,
        resize: isCollapsed ? 'none' : 'both',
        border: `1px solid ${colors.border}`,
        fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace"
      }}
      onMouseDown={handleMouseDown}
    >
      <div 
        className="drag-handle"
        style={{
          height: '30px',
          backgroundColor: colors.headerBg,
          padding: '5px 10px',
          cursor: 'move',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <span style={{ color: colors.headerText, fontWeight: 'bold', fontSize: '12px' }}>Vars</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <button
            onClick={() => setFontSize(s => Math.max(8, s - 1))}
            style={{ background: 'none', border: `1px solid ${colors.buttonBorder}`, borderRadius: '3px', color: colors.headerText, cursor: 'pointer', width: '22px', height: '22px', fontSize: '13px', lineHeight: '1', padding: 0 }}
            title="Zoom out"
          >−</button>
          <button
            onClick={() => setFontSize(s => Math.min(24, s + 1))}
            style={{ background: 'none', border: `1px solid ${colors.buttonBorder}`, borderRadius: '3px', color: colors.headerText, cursor: 'pointer', width: '22px', height: '22px', fontSize: '13px', lineHeight: '1', padding: 0 }}
            title="Zoom in"
          >+</button>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.headerText,
              cursor: 'pointer',
              marginRight: '5px'
            }}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>
      
      {!isCollapsed && (
        <div style={{ overflow: 'auto', maxHeight: 'calc(80vh - 30px)', padding: '5px' }}>
          {hasVariables ? (
            <div className="var-ui-wrapper">
              {Object.entries(variablesByNode).map(([nodeId, nodeVars]) => {
                // Get the first variable's nodeName and nodePath for display
                const nodeName = nodeVars[0]?.nodeName || 'Unknown';
                const nodePath = nodeVars[0]?.nodePath || 'Unknown Path';
                
                return (
                  <div key={nodeId} className="node-vars">
                    <h3 style={{ 
                      color: colors.textSecondary, 
                      fontSize: `${fontSize + 2}px`, 
                      borderBottom: `1px solid ${colors.border}`,
                      marginBottom: '5px',
                      paddingBottom: '3px',
                      fontWeight: 'bold'
                    }}>
                      {nodeId.includes('root') ? '● ' : '○ '}
                      PID: {nodeName}
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {nodeVars.map((variable, idx) => (
                          <tr key={`${nodeId}-${variable.name}-${idx}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                            <td style={{ color: colors.text, padding: '2px 5px', fontSize: `${fontSize}px`, width: '50%', fontWeight: 'bold' }}>
                              <span title={variable.type}>{variable.name}</span>
                            </td>
                            <td style={{ color: colors.valueColor, padding: '2px 5px', fontSize: `${fontSize}px`, width: '50%', fontWeight: 'bold' }}>
                              {variable.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '10px', color: colors.text, textAlign: 'center', opacity: 0.7 }}>
              No variables to display yet
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FloatingVarUI; 