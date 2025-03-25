import React, { useState, useEffect, useRef, useCallback } from 'react';
import { VarUI, VarCategory, VarNumber, VarString, VarToggle } from 'react-var-ui';
import 'react-var-ui/index.css';
import './FloatingVarUI.css';
import { TreeNode, VariableInfo } from '../types';

interface FloatingVarUIProps {
  isDebugging: boolean;
  debuggerRef?: React.RefObject<any>;
  data?: TreeNode; // Add the tree data to access all debugger instances
}

const FloatingVarUI: React.FC<FloatingVarUIProps> = ({ isDebugging, debuggerRef, data }) => {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: 70 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
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
    if (e.target === floatingPanelRef.current?.querySelector('.drag-handle')) {
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX - position.x, 
        y: e.clientY - position.y 
      });
    }
  };

  // Update position while dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const newX = Math.max(0, Math.min(window.innerWidth - 300, e.clientX - dragStart.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragStart.y));
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

  return (
    <div 
      className="floating-var-ui" 
      ref={floatingPanelRef}
      style={{ 
        position: 'fixed',
        top: `${position.y}px`, 
        left: `${position.x}px`,
        width: isCollapsed ? '240px' : '300px',
        height: isCollapsed ? '40px' : 'auto',
        maxHeight: '80vh',
        backgroundColor: '#1e1e2e',
        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.3)',
        borderRadius: '4px',
        overflow: 'hidden',
        zIndex: 9999,
        resize: 'both'
      }}
      onMouseDown={handleMouseDown}
    >
      <div 
        className="drag-handle"
        style={{
          height: '30px',
          backgroundColor: '#2a2a3a',
          padding: '5px 10px',
          cursor: 'move',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span style={{ color: '#ffffff' }}>Program Variables</span>
        <div style={{ display: 'flex' }}>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              marginRight: '5px'
            }}
          >
            {isCollapsed ? '🔽' : '🔼'}
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
                      color: '#cdd6f4', 
                      fontSize: '14px', 
                      borderBottom: '1px solid #313244',
                      marginBottom: '5px',
                      paddingBottom: '3px'
                    }}>
                      {nodeId.includes('root') ? '🔵 ' : '🟢 '}
                      Node ID: {nodeId.substring(0, 8)}... 
                      {nodeName !== nodeId.substring(0, 8) && ` (${nodeName})`}
                    </h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {nodeVars.map((variable, idx) => (
                          <tr key={`${nodeId}-${variable.name}-${idx}`} style={{ borderBottom: '1px solid #282a36' }}>
                            <td style={{ color: '#bac2de', padding: '2px 5px', fontSize: '12px', width: '50%' }}>
                              <span title={variable.type}>{variable.name}</span>
                            </td>
                            <td style={{ color: '#a6e3a1', padding: '2px 5px', fontSize: '12px', width: '50%', fontFamily: 'monospace' }}>
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
            <div style={{ padding: '10px', color: '#aaa', textAlign: 'center' }}>
              No variables to display yet
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FloatingVarUI; 