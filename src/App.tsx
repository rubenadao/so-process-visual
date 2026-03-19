import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TreeVisualizer } from './components/TreeVisualizer';
import DebugPanel from './components/DebugPanel';
import Splitter from './components/Splitter';
import FloatingVarUI from './components/FloatingVarUI';
import { TreeNode } from './types';
import { CInterpDebugger, InterpreterState, ForkEvent, WaitCallback } from './lib/cinterp';
import cloneDeep from 'lodash/cloneDeep';
import { scenarios } from './scenarios';

// localStorage keys
const STORAGE_KEYS = {
  SETTINGS: 'so-process-visual-settings',
  SCENARIO_INDEX: 'so-process-visual-scenario-index',
  EDITOR_CODE: 'so-process-visual-editor-code'
};

// Load persisted values from localStorage
const loadPersistedSettings = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
  }
  return null;
};

const loadPersistedScenarioIndex = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SCENARIO_INDEX);
    if (stored !== null) {
      const index = parseInt(stored, 10);
      if (index >= 0 && index < scenarios.length) {
        return index;
      }
    }
  } catch (e) {
    console.warn('Failed to load scenario index from localStorage:', e);
  }
  return 0;
};

const loadPersistedEditorCode = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.EDITOR_CODE);
    if (stored) {
      return stored;
    }
  } catch (e) {
    console.warn('Failed to load editor code from localStorage:', e);
  }
  return null;
};

const defaultCode = scenarios[0].code;

const App: React.FC = () => {
  // Load persisted values
  const persistedSettings = loadPersistedSettings();
  const persistedScenarioIndex = loadPersistedScenarioIndex();
  const persistedEditorCode = loadPersistedEditorCode();
  
  const [data, setData] = useState<TreeNode | null>(null);
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(persistedScenarioIndex);
  const [editorCode, setEditorCode] = useState<string>(
    persistedEditorCode || scenarios[persistedScenarioIndex].code
  );
  const [stats, setStats] = useState({ steps: 0, totalNodes: 0, generation: 0 });
  const [isCompactMode, setIsCompactMode] = useState(persistedSettings?.isCompactMode ?? false);
  const [isHorizontalLayout, setIsHorizontalLayout] = useState(persistedSettings?.isHorizontalLayout ?? false);
  const [spacingMultiplier, setSpacingMultiplier] = useState(persistedSettings?.spacingMultiplier ?? 1.5);
  const [showSettings, setShowSettings] = useState(false);
  const [editorTheme, setEditorTheme] = useState(persistedSettings?.editorTheme ?? 'chrome');
  const [showInlineVariables, setShowInlineVariables] = useState(persistedSettings?.showInlineVariables ?? true);
  const [boxDimensions, setBoxDimensions] = useState({ width: 300, height: 350 });
  const [isDebugging, setIsDebugging] = useState(false);
  const [currentLine, setCurrentLine] = useState<number>(-1);
  const [sidebarWidth, setSidebarWidth] = useState(persistedSettings?.sidebarWidth ?? 400);
  const [mainEditorHeight, setMainEditorHeight] = useState(persistedSettings?.mainEditorHeight ?? 250);
  const [showTree, setShowTree] = useState(false);
  const debuggerRef = useRef<any>(null);
  const [output, setOutput] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const pendingForkEventsRef = useRef<Array<{nodeId: string, event: ForkEvent, debugger_: CInterpDebugger}>>([]);
  
  // Track parent-child relationships and terminated children
  // Maps parent's node ID to an array of terminated child PIDs with their exit status
  const terminatedChildrenRef = useRef<Map<string, Array<{childPid: number, exitStatus: number}>>>(new Map());
  // Maps node ID to its PID
  const nodeIdToPidRef = useRef<Map<string, number>>(new Map());
  // Maps PID to node ID (for finding parent node by PID)
  const pidToNodeIdRef = useRef<Map<number, string>>(new Map());

  // Persist settings to localStorage
  useEffect(() => {
    const settings = {
      isCompactMode,
      isHorizontalLayout,
      spacingMultiplier,
      editorTheme,
      showInlineVariables,
      sidebarWidth,
      mainEditorHeight
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }, [isCompactMode, isHorizontalLayout, spacingMultiplier, editorTheme, showInlineVariables, sidebarWidth, mainEditorHeight]);

  // Persist selected scenario index
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SCENARIO_INDEX, String(selectedScenarioIndex));
  }, [selectedScenarioIndex]);

  // Persist editor code (only if different from current scenario default)
  useEffect(() => {
    const scenarioDefault = scenarios[selectedScenarioIndex].code;
    if (editorCode !== scenarioDefault) {
      localStorage.setItem(STORAGE_KEYS.EDITOR_CODE, editorCode);
    } else {
      // Clear custom code if it matches the default
      localStorage.removeItem(STORAGE_KEYS.EDITOR_CODE);
    }
  }, [editorCode, selectedScenarioIndex]);

  // Calculate available space for visualization
  const headerHeight = 0; // Removed heading and description
  const windowHeight = window.innerHeight;
  const availableHeight = windowHeight - headerHeight - 40; // 40px for margins

  // Calculate appropriate node dimensions based on code content
  const calculateDimensionsFromCode = (code: string) => {
    const lines = code.split('\n');
    const lineCount = lines.length;
    const maxLineLength = Math.max(...lines.map(line => line.length));
    
    // Calculate width based on longest line
    // Ace Editor uses ~8.4px per character with 14px font, plus gutter (~45px) and padding
    const calculatedWidth = Math.max(300, maxLineLength * 8.4 + 60);
    
    // Calculate height based on line count
    // Ace Editor CSS: font-size 14px, line-height 1.5 = 21px per line exactly
    // Plus 4px for foreignObject padding (2px top + 2px bottom from TreeNode)
    // Plus 2px for editor border (1px top + 1px bottom from AceEditor.css)
    const calculatedHeight = lineCount * 21 + 6;
    
    return { width: calculatedWidth, height: calculatedHeight };
  };

  const generateNodeId = () => `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  let nextNodeNumber = 1001;  // Track the next number to use

  const createNewNode = (parentNode: TreeNode): TreeNode => {
    console.log(`Creating new node from parent ${parentNode.id}`);
    
    // Create a complete deep clone of the parent node
    const newNode: TreeNode = cloneDeep(parentNode);
    
    // Only change these specific properties:
    
    // 1. Generate a new unique ID
    newNode.id = generateNodeId();
    
    // 2. Update the name (if you want it to be different)
    // If name should be different from parent, uncomment and modify this line:
    // newNode.name = `${parentNode.name}-child`;
    
    // 3. Reset children array to empty
    newNode.children = [];
    
    // 4. Properly clone the debugger instance (this is special handling)
    if (parentNode.isDebugging && parentNode.debuggerInstance) {
      console.log(`Creating debugger clone for new node ${newNode.id} from parent ${parentNode.id}`);
      
      // Clone the debugger instance separately
      newNode.debuggerInstance = cloneDebuggerState(parentNode.debuggerInstance, newNode.id);
      
      // Make sure debugging state is preserved
        newNode.isDebugging = true;
      newNode.currentLine = parentNode.currentLine;
      
      console.log(`Debugger clone created with line ${newNode.currentLine}`);
    }
    
    console.log(`Finished creating node ${newNode.id}`);
    return newNode;
  };

  // Function to clone a debugger instance's state to preserve exact execution context
  const cloneDebuggerState = (sourceDebugger: any, newNodeId: string): any => {
    if (!sourceDebugger) return null;
    
    console.log(`Cloning debugger state from source to new node ${newNodeId}`);
    
    // Get the state from the source debugger
    const state = sourceDebugger.getState?.();
    if (!state) {
      console.error('Cannot clone debugger: state not available');
      return null;
    }
    
    // Get the source code
    const code = sourceDebugger.interp?.code || '';
    if (!code) {
      console.error('Cannot clone debugger: source code not available');
      return null;
    }
    
    // Create handlers for the new debugger
    const handleOutputChange = (newOutput: string) => {
      setOutput(prevOutput => prevOutput + newOutput);
    };
    
    try {
      // Create a deep clone of the state for the child
      const childState: InterpreterState = cloneDeep(state);
      
      // Child process sees pid as 0
      childState.variables.set('pid', { name: 'pid', value: 0, type: 'int' });
      
      // Use the static fromState method to create the child debugger
      const clonedDebugger = CInterpDebugger.fromState(
        code,
        childState,
        newNodeId,
        handleOutputChange
      );
      
      console.log(`Child debugger created at line ${clonedDebugger.getCurrentLine()}`);
      
      // Set up fork handler for the child process
      setupForkHandler(clonedDebugger, newNodeId);
      
      return clonedDebugger;
    } catch (error) {
      console.error('Error cloning debugger state:', error);
      return null;
    }
  };

  // Function to set up fork event handling on a debugger
  const setupForkHandler = (debugger_: CInterpDebugger, nodeId: string) => {
    console.log(`Setting up fork handler for node ${nodeId}`);
    debugger_.setOnFork((event: ForkEvent) => {
      console.log(`Fork event fired from ${nodeId}`);
      // Collect fork event for inline processing during step
      pendingForkEventsRef.current.push({ nodeId, event, debugger_ });
    });
  };

  // Function to set up wait callback on a debugger
  // Returns the first terminated child of the given parent PID
  const setupWaitHandler = (debugger_: CInterpDebugger, nodeId: string) => {
    debugger_.setOnWait((parentPid: number) => {
      // Find the node ID for this parent PID
      const parentNodeId = pidToNodeIdRef.current.get(parentPid) || nodeId;
      const terminatedChildren = terminatedChildrenRef.current.get(parentNodeId);
      
      console.log(`wait() called by PID ${parentPid} (nodeId: ${parentNodeId}), terminated children:`, terminatedChildren);
      
      if (terminatedChildren && terminatedChildren.length > 0) {
        // Return and remove the first terminated child
        const child = terminatedChildren.shift()!;
        console.log(`wait() returning terminated child PID ${child.childPid} with exit status ${child.exitStatus}`);
        return child;
      }
      
      console.log(`wait() blocking - no terminated children yet`);
      return null;
    });
  };

  // Function to create a child node from a fork event (called inline during stepping)
  const createChildFromForkEvent = (
    parentNode: TreeNode, 
    event: ForkEvent, 
    debugger_: CInterpDebugger
  ): TreeNode | null => {
    const childState = event.childState;
    if (!childState) {
      console.error('Fork event missing child state');
      return null;
    }
    
    const newNodeId = generateNodeId();
    const code = debugger_.interp?.code || parentNode.code || '';
    
    const handleOutputChange = (newOutput: string) => {
      setOutput(prevOutput => prevOutput + newOutput);
    };
    
    console.log(`Child state before creation: pc=${childState.pc}, finished=${childState.finished}`);
    
    const childDebugger = CInterpDebugger.fromState(
      code,
      childState,
      newNodeId,
      handleOutputChange
    );
    
    setupForkHandler(childDebugger, newNodeId);
    setupWaitHandler(childDebugger, newNodeId);
    
    // Track child PID and parent relationship
    nodeIdToPidRef.current.set(newNodeId, event.childPid);
    pidToNodeIdRef.current.set(event.childPid, newNodeId);
    
    // Verify fork handler is set
    const interpHasForkHandler = !!(childDebugger.interp as any)?.onFork;
    console.log(`Created child ${newNodeId}: pc=${childDebugger.interp?.getState()?.pc}, interp.onFork set: ${interpHasForkHandler}`);
    
    return {
      id: newNodeId,
      name: `${event.childPid}`,
      description: `Child process ${event.childPid}`,
      code: code,
      debuggerInstance: childDebugger,
      isDebugging: true,
      currentLine: childDebugger.getCurrentLine(),
      currentRange: childDebugger.getCurrentRange(),
      children: [],
      parentNodeId: parentNode.id,  // Track parent for wait()
    };
  };

  const addChildToRoot = () => {
    setData(prevData => {
      if (!prevData) return null;
      return {
        ...prevData,
        children: [...(prevData.children || []), createNewNode(prevData)]
      };
    });
  };

  const addChildToAllNodes = () => {
    const addChildrenRecursively = (node: TreeNode): TreeNode => ({
      ...node,
      children: [
        ...(node.children || []).map(addChildrenRecursively),
        createNewNode(node)
      ]
    });

    setData(prevData => prevData ? addChildrenRecursively(prevData) : null);
  };

  const addRandomChild = () => {
    if (!data) return;
    
    const findRandomNode = (node: TreeNode, nodes: TreeNode[]): void => {
      nodes.push(node);
      if (node.children) {
        node.children.forEach(child => findRandomNode(child, nodes));
      }
    };

    const allNodes: TreeNode[] = [];
    findRandomNode(data, allNodes);
    const randomNode = allNodes[Math.floor(Math.random() * allNodes.length)];

    const addChildToNode = (node: TreeNode, targetId: string): TreeNode => {
      if (node.id === targetId) {
        return {
          ...node,
          children: [...(node.children || []), createNewNode(node)]
        };
      }
      if (!node.children) return node;
      return {
        ...node,
        children: node.children.map(child => addChildToNode(child, targetId))
      };
    };

    setData(prevData => prevData ? addChildToNode(prevData, randomNode.id) : null);
  };

  const updateStats = useCallback((_generation: number, totalNodes: number) => {
    setStats(prev => ({ ...prev, totalNodes }));
  }, []);

  const toggleCompactMode = () => {
    setIsCompactMode(!isCompactMode);
  };

  const handleNodeResize = useCallback((width: number, height: number) => {
    setBoxDimensions({ width, height });
  }, []);

  const handleNodeClick = useCallback((node: TreeNode) => {
    console.log('Node clicked:', node);
  }, []);

  // Function to create a new debugger instance for a node
  const createNodeDebugger = (nodeId: string, code: string, isChildProcess: boolean = false) => {
    console.log(`Creating debugger for node ${nodeId}, isChildProcess: ${isChildProcess}`);
    
    const handleOutputChange = (newOutput: string) => {
      // Simply append the new output without adding node identifiers
      // This simulates all nodes sharing the same output device
      setOutput(prevOutput => prevOutput + newOutput);
    };

    // Create the debugger instance using the new CInterp adapter
    // Line state is managed internally by each runtime - read via getCurrentLine()
    const debuggerInstance = new CInterpDebugger(
      handleOutputChange,
      nodeId,
      isChildProcess
    );
    
    console.log(`Created debugger with nodeId=${nodeId}`);
    
    // Set input
    debuggerInstance.setInput(input);
    
    return debuggerInstance;
  };

  // Function to update a specific node's property
  const updateNodeProperty = (node: TreeNode, targetId: string, property: string, value: any): TreeNode => {
    if (node.id === targetId) {
      return {
        ...node,
        [property]: value
      };
    }
    
    if (!node.children) return node;
    
    return {
      ...node,
      children: node.children.map(child => updateNodeProperty(child, targetId, property, value))
    };
  };

  // Function to initialize debuggers for all nodes
  const initializeAllDebuggers = async () => {
    // Reset PID tracking maps
    terminatedChildrenRef.current.clear();
    nodeIdToPidRef.current.clear();
    pidToNodeIdRef.current.clear();
    
    // Create and start debuggers in a single operation
    setData(prevData => {
      if (!prevData) return null;
      
      const initNode = (node: TreeNode): TreeNode => {
        // Create debugger for this node
        const debuggerInstance = createNodeDebugger(node.id, node.code || '', false);
        
        // Set up fork handler for this node
        setupForkHandler(debuggerInstance, node.id);
        setupWaitHandler(debuggerInstance, node.id);
        
        // Start debugging immediately
        if (node.code) {
          try {
            debuggerInstance.startDebugSync(node.code);
            
            // Track root process PID (1000)
            if (node.id === 'root') {
              const rootPid = 1000;  // Root always has PID 1000
              nodeIdToPidRef.current.set(node.id, rootPid);
              pidToNodeIdRef.current.set(rootPid, node.id);
            }
          } catch (error) {
            console.error(`Failed to start debugging for node ${node.id}:`, error);
          }
        }
        
        return {
          ...node,
          debuggerInstance,
          isDebugging: true,
          currentLine: debuggerInstance.getCurrentLine(),
          currentRange: debuggerInstance.getCurrentRange(),
          children: node.children ? node.children.map(initNode) : undefined
        };
      };
      
      return initNode(prevData);
    });
  };

  // Function to step all debuggers
  const stepAllDebuggers = () => {
    // Clear pending fork events
    pendingForkEventsRef.current = [];
    
    // Step all debuggers and process fork events in a single state update
    setData(prevData => {
      if (!prevData) return null;
      
      const stepNode = (node: TreeNode): TreeNode => {
        console.log(`stepNode: ${node.id}, children: ${node.children?.length || 0}, isDebugging: ${node.isDebugging}`);
        // First, recursively step children
        const steppedChildren = node.children ? node.children.map(stepNode) : [];
        
        if (node.debuggerInstance && node.isDebugging) {
          try {
            const interpState = node.debuggerInstance.interp?.getState();
            console.log(`Stepping ${node.id}: pc=${interpState?.pc}, finished=${interpState?.finished}, hasForkHandler=${!!(node.debuggerInstance.interp as any)?.onFork}`);
            
            // Check if debugger is still actively debugging
            if (!node.debuggerInstance.isDebugging()) {
              console.log(`Node ${node.id} has finished debugging`);
              return {
                ...node,
                isDebugging: false,
                isTerminated: true,
                currentLine: -1,
                children: steppedChildren
              };
            }
            
            // Clear pending events before stepping this node
            const beforeStepEventCount = pendingForkEventsRef.current.length;
            
            // Step the debugger - this may trigger fork events
            node.debuggerInstance.stepNext();
            
            const afterStepState = node.debuggerInstance.interp?.getState();
            console.log(`After step ${node.id}: pc=${afterStepState?.pc}, finished=${afterStepState?.finished}`);
            
            // Check for fork events from this node
            const newEvents = pendingForkEventsRef.current.slice(beforeStepEventCount);
            const thisNodeEvents = newEvents.filter(e => e.nodeId === node.id);
            
            console.log(`Node ${node.id}: ${newEvents.length} new events, ${thisNodeEvents.length} for this node`);
            if (newEvents.length > 0 && thisNodeEvents.length === 0) {
              console.log(`  Event nodeIds: ${newEvents.map(e => e.nodeId).join(', ')}`);
            }
            
            // If debugging has finished for this node
            if (!node.debuggerInstance.isDebugging()) {
              console.log(`Debugging finished for node ${node.id}`);
              
              // Register this process as terminated so its parent can wait() for it
              const childPid = nodeIdToPidRef.current.get(node.id);
              const parentNodeId = node.parentNodeId;
              if (childPid && parentNodeId) {
                const exitStatus = node.debuggerInstance.interp?.getState()?.exitCode ?? 0;
                // Add to parent's terminated children list
                if (!terminatedChildrenRef.current.has(parentNodeId)) {
                  terminatedChildrenRef.current.set(parentNodeId, []);
                }
                terminatedChildrenRef.current.get(parentNodeId)!.push({
                  childPid,
                  exitStatus
                });
                console.log(`Child PID ${childPid} terminated with exit status ${exitStatus}, parent node: ${parentNodeId}`);
              }
              
              return {
                ...node,
                isDebugging: false,
                isTerminated: true,
                currentLine: -1,
                currentRange: null,
                children: steppedChildren
              };
            }
            
            // Get current line and range AFTER stepping
            const currentLine = node.debuggerInstance.getCurrentLine ? 
              node.debuggerInstance.getCurrentLine() : -1;
            const currentRange = node.debuggerInstance.getCurrentRange ? 
              node.debuggerInstance.getCurrentRange() : null;
            
            console.log(`Node ${node.id} stepped to line ${currentLine}`);
            
            // Process any fork events from this node - create children inline
            let newChildren = [...steppedChildren];
            for (const { event, debugger_ } of thisNodeEvents) {
              const childNode = createChildFromForkEvent(node, event, debugger_);
              if (childNode) {
                newChildren.push(childNode);
                console.log(`Added child ${childNode.id} to ${node.id}`);
              }
            }
            
            // Check if process is blocked on wait()
            const isWaiting = node.debuggerInstance.interp?.getState()?.waiting ?? false;
            if (isWaiting) {
              console.log(`Node ${node.id} is BLOCKED on wait()`);
            }
            
            return {
              ...node,
              currentLine: currentLine,
              currentRange: currentRange,
              isWaiting: isWaiting,
              children: newChildren
            };
          } catch (error) {
            console.error(`Failed to step debugger for node ${node.id}:`, error);
            return {
              ...node,
              isDebugging: false,
              isTerminated: true,
              currentLine: -1,
              currentRange: null,
              children: steppedChildren
            };
          }
        }
        
        return {
          ...node,
          children: steppedChildren
        };
      };
      
      const result = stepNode(prevData);
      console.log(`Step complete. Root children: ${result.children?.length || 0}`);
      return result;
    });
  };

  // Function to step a single node by its ID
  const stepSingleNode = (nodeId: string) => {
    pendingForkEventsRef.current = [];

    setData(prevData => {
      if (!prevData) return null;

      const stepTargetNode = (node: TreeNode): TreeNode => {
        // Recurse into children first
        const steppedChildren = node.children ? node.children.map(stepTargetNode) : [];

        // Only step the matching node
        if (node.id !== nodeId || !node.debuggerInstance || !node.isDebugging) {
          return { ...node, children: steppedChildren };
        }

        try {
          if (!node.debuggerInstance.isDebugging()) {
            return { ...node, isDebugging: false, isTerminated: true, currentLine: -1, currentRange: null, children: steppedChildren };
          }

          const beforeStepEventCount = pendingForkEventsRef.current.length;
          node.debuggerInstance.stepNext();

          if (!node.debuggerInstance.isDebugging()) {
            // Register this process as terminated so its parent can wait() for it
            const childPid = nodeIdToPidRef.current.get(node.id);
            const parentNodeId = node.parentNodeId;
            if (childPid && parentNodeId) {
              const exitStatus = node.debuggerInstance.interp?.getState()?.exitCode ?? 0;
              if (!terminatedChildrenRef.current.has(parentNodeId)) {
                terminatedChildrenRef.current.set(parentNodeId, []);
              }
              terminatedChildrenRef.current.get(parentNodeId)!.push({
                childPid,
                exitStatus
              });
              console.log(`[stepSingleNode] Child PID ${childPid} terminated with exit status ${exitStatus}, parent node: ${parentNodeId}`);
            }
            return { ...node, isDebugging: false, isTerminated: true, currentLine: -1, currentRange: null, children: steppedChildren };
          }

          const currentLine = node.debuggerInstance.getCurrentLine ? node.debuggerInstance.getCurrentLine() : -1;
          const currentRange = node.debuggerInstance.getCurrentRange ? node.debuggerInstance.getCurrentRange() : null;
          const isWaiting = node.debuggerInstance.interp?.getState()?.waiting ?? false;

          // Process fork events
          const newEvents = pendingForkEventsRef.current.slice(beforeStepEventCount);
          const thisNodeEvents = newEvents.filter(e => e.nodeId === node.id);
          let newChildren = [...steppedChildren];
          for (const { event, debugger_ } of thisNodeEvents) {
            const childNode = createChildFromForkEvent(node, event, debugger_);
            if (childNode) newChildren.push(childNode);
          }

          return { ...node, currentLine, currentRange, isWaiting, children: newChildren };
        } catch (error) {
          console.error(`Failed to step node ${node.id}:`, error);
          return { ...node, isDebugging: false, isTerminated: true, currentLine: -1, currentRange: null, children: steppedChildren };
        }
      };

      return stepTargetNode(prevData);
    });

    setStats(prev => ({ ...prev, steps: prev.steps + 1 }));
  };

  // Function to stop all debuggers
  const stopAllDebuggers = () => {
    setData(prevData => {
      if (!prevData) return null;
      const stopNode = (node: TreeNode): TreeNode => {
        if (node.debuggerInstance) {
          node.debuggerInstance.stop();
        }
        
        return {
          ...node,
          debuggerInstance: undefined,
          isDebugging: false,
          currentLine: -1,
          currentRange: null,
          children: node.children ? node.children.map(stopNode) : undefined
        };
      };
      
      return stopNode(prevData);
    });
    
    // Clear the output area for next run
    setOutput('');
  };

  const handleRunProgram = () => {
    console.log('Starting program and initializing debuggers...');
    setIsDebugging(true);
    setStats(prev => ({ ...prev, steps: 0 }));  // Reset steps on new run
    
    // Create the initial root node from the editor code
    const rootNode: TreeNode = {
      id: 'root',
      name: '1000',
      description: 'Root process',
      code: editorCode,
      children: []
    };
    setData(rootNode);
    setShowTree(true);
    
    // Calculate and set appropriate node dimensions based on the code
    const dimensions = calculateDimensionsFromCode(editorCode);
    setBoxDimensions(dimensions);
    
    // Initialize debuggers after setting the data (use setTimeout to ensure state is updated)
    setTimeout(() => {
      initializeAllDebuggers();
    }, 0);
  };

  const handleStopProgram = () => {
    stopAllDebuggers();
    setIsDebugging(false);
    setCurrentLine(-1);
  };

  // Handler for stepping the debugger
  const handleStepNext = () => {
    if (!isDebugging) return;
    
    console.log('Stepping all debuggers...');
    stepAllDebuggers();
    
    // Increment step counter
    setStats(prev => ({ ...prev, steps: prev.steps + 1 }));
    
    // Force refresh the variables UI using multiple stages
    // This ensures that variables are properly updated across the tree
    
    // First refresh - immediately after stepping
    setData(prevData => prevData ? { ...prevData } : null);
    
    // Second refresh - after a delay to allow JSCPP runtime to update
    setTimeout(() => {
      setData(prevData => prevData ? { ...prevData } : null);
      
      // Third refresh - after another delay to capture any late updates
      setTimeout(() => {
        setData(prevData => prevData ? { ...prevData } : null);
      }, 100);
    }, 50);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    
    // Update input for all active debuggers
    setData(prevData => {
      if (!prevData) return null;
      const updateInput = (node: TreeNode): TreeNode => {
        if (node.debuggerInstance) {
          node.debuggerInstance.setInput(e.target.value);
        }
        
        return {
          ...node,
          children: node.children ? node.children.map(updateInput) : undefined
        };
      };
      
      return updateInput(prevData);
    });
  };

  const handleResetTree = () => {
    setData(null);
    setShowTree(false);
    setIsDebugging(false);
    setCurrentLine(-1);
    setStats({ steps: 0, totalNodes: 0 });
    nextNodeNumber = 1001;
  };

  const handleSplitterResize = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth);
  }, []);

  const handleCodeChange = useCallback((newCode: string) => {
    setEditorCode(newCode);
    // Also update root node code if debugging is active
    if (data) {
      setData(prevData => prevData ? {
        ...prevData,
        code: newCode
      } : null);
    }
  }, [data]);

  // Store a reference to the debugger instance when it's created
  const handleDebuggerCreated = (debuggerInstance: any) => {
    debuggerRef.current = debuggerInstance;
  };

  // Calculate canvas width based on window width minus sidebar width
  const canvasWidth = window.innerWidth - sidebarWidth - 6; // 6px for splitter width

  // Helper function to count nodes in the tree
  const getNodeCount = (node: TreeNode): number => {
    let count = 1; // Count this node
    if (node.children && node.children.length > 0) {
      // Add the count of all children
      count += node.children.reduce((sum, child) => sum + getNodeCount(child), 0);
    }
    return count;
  };

  return (
    <div className="app">
      <div className="container">
        <div className="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <div className="control-group">
            <label className="select-label">Saved Programs</label>
            <select 
              className="program-select"
              value={selectedScenarioIndex}
              onChange={(e) => {
                const newIndex = parseInt(e.target.value, 10);
                setSelectedScenarioIndex(newIndex);
                // Reset to scenario default code, clearing any custom edits
                setEditorCode(scenarios[newIndex].code);
                localStorage.removeItem(STORAGE_KEYS.EDITOR_CODE);
                // Reset execution when loading a new program
                if (isDebugging) {
                  handleStopProgram();
                }
                setData(null);
                setShowTree(false);
                setOutput('');
                setStats({ generation: 0, totalNodes: 0, steps: 0 });
              }}
            >
              {scenarios.map((program, index) => (
                <option key={index} value={index}>
                  {program.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="control-group">
            <button
              className={`btn-toggle ${isCompactMode ? 'active' : ''}`}
              onClick={toggleCompactMode}
            >
              Compact Mode
            </button>
            <button
              className={`btn-toggle ${isHorizontalLayout ? 'active' : ''}`}
              onClick={() => setIsHorizontalLayout(!isHorizontalLayout)}
            >
              Horizontal Layout
            </button>
            <button
              className="btn-toggle btn-settings"
              onClick={() => setShowSettings(!showSettings)}
              style={{ marginLeft: 'auto' }}
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </div>

          {showSettings && (
            <div className="settings-panel">
              <div className="settings-header">
                <span className="settings-title">Settings</span>
                <button
                  className="btn-reset"
                  onClick={() => {
                    setSpacingMultiplier(1.5);
                    setEditorTheme('chrome');
                    setShowInlineVariables(true);
                  }}
                  title="Reset settings to defaults"
                >
                  Reset Defaults
                </button>
              </div>
              <div className="control-group" style={{ opacity: isCompactMode ? 0.5 : 1, flexDirection: 'column', alignItems: 'stretch', marginBottom: 0 }}>
                <label className="select-label" style={{ marginBottom: '4px', fontSize: '12px' }}>Connection Length: {spacingMultiplier.toFixed(1)}x</label>
                <input
                  type="range"
                  min="1.0"
                  max="3.0"
                  step="0.1"
                  value={spacingMultiplier}
                  onChange={(e) => setSpacingMultiplier(parseFloat(e.target.value))}
                  disabled={isCompactMode}
                  style={{ width: '100%', cursor: isCompactMode ? 'not-allowed' : 'pointer' }}
                />
              </div>
              <div className="control-group" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: '8px' }}>
                <label className="select-label" style={{ marginBottom: '4px', fontSize: '12px' }}>Editor Theme</label>
                <select
                  value={editorTheme}
                  onChange={(e) => setEditorTheme(e.target.value)}
                  style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', background: '#fff', color: '#333' }}
                >
                  <option value="monokai">Monokai (Dark)</option>
                  <option value="github">GitHub (Light)</option>
                  <option value="chrome">Chrome (Light)</option>
                  <option value="tomorrow">Tomorrow (Light)</option>
                  <option value="twilight">Twilight (Dark)</option>
                  <option value="ambiance">Ambiance (Dark)</option>
                </select>
              </div>
              <div className="control-group" style={{ flexDirection: 'row', alignItems: 'center', marginTop: '8px', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="inline-vars-toggle"
                  checked={showInlineVariables}
                  onChange={(e) => setShowInlineVariables(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="inline-vars-toggle" className="select-label" style={{ fontSize: '12px', cursor: 'pointer', margin: 0 }}>
                  Show variables per node
                </label>
              </div>
            </div>
          )}

          <DebugPanel
            code={editorCode}
            onRun={handleRunProgram}
            onStop={handleStopProgram}
            onStepNext={handleStepNext}
            isDebugging={isDebugging}
            onLineChange={setCurrentLine}  // Keep tracking currentLine for tree nodes
            onCodeChange={handleCodeChange}
            onDebuggerCreated={handleDebuggerCreated}
            output={output}
            input={input}
            onInputChange={handleInputChange}
            editorTheme={editorTheme}
            initialEditorHeight={mainEditorHeight}
            onEditorHeightChange={setMainEditorHeight}
          />

          <div className="stats">
            <div className="stat-item">
              <div className="stat-label">Steps</div>
              <div className="stat-value">{stats.steps}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Total Processes</div>
              <div className="stat-value">{stats.totalNodes}</div>
            </div>
          </div>
        </div>

        <Splitter onResize={handleSplitterResize} />

        <div className="canvas-container" style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          margin: 0,
          padding: 0
        }}>
          {showTree && data ? (
            <TreeVisualizer
              data={data}
              width={canvasWidth}
              height={window.innerHeight}
              boxWidth={boxDimensions.width}
              boxHeight={boxDimensions.height}
              nodeSeparation={2.2}
              marginTop={100}
              marginRight={60}
              marginBottom={0}
              marginLeft={60}
              nodeRadius={5}
              nodeColor="#4287f5"
              linkColor="#ccc"
              verticallyConstrained={true}
              isCompactMode={isCompactMode}
              isHorizontalLayout={isHorizontalLayout}
              spacingMultiplier={spacingMultiplier}
              editorTheme={editorTheme}
              showInlineVariables={showInlineVariables}
              onStatsUpdate={updateStats}
              currentLine={currentLine}
              onNodeResize={handleNodeResize}
              onNodeClick={handleNodeClick}
              onStepNode={stepSingleNode}
            />
          ) : (
            <div className="empty-canvas-message" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p>Run the program to visualize the execution tree</p>
            </div>
          )}
        </div>
        
        {/* Floating Variables UI - only show when not using inline variables */}
        {!showInlineVariables && (
          <FloatingVarUI isDebugging={isDebugging} debuggerRef={debuggerRef} data={data} editorTheme={editorTheme} />
        )}
      </div>
    </div>
  );
};

export default App; 