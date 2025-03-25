import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TreeVisualizer } from './components/TreeVisualizer';
import DebugPanel from './components/DebugPanel';
import Splitter from './components/Splitter';
import FloatingVarUI from './components/FloatingVarUI';
import { TreeNode } from './types';
import { CPPDebugger } from './lib/jscpp/debugger';
import { forkEventBus } from './lib/custom_functions';
import cloneDeep from 'lodash/cloneDeep';

const initialData: TreeNode = {
  id: 'root',
  name: '1000',
  description: 'Start node',
  hasImage: true,
  imageUrl: 'https://picsum.photos/50/50',
  hasIcon: true,
  customHtml: "<div class='custom-content'><button><i class='fas fa-cog'></i> Click me</button></div>",
  code: `#include <stdio.h>
#include <process.h>

int main() {
    // Initialize variables
    int counter = 0;
    printf("Parent process starting\\n");
    
    // Call fork to create a child process
    int pid = fork();
    printf("Process ID: %d\\n", pid);
    
    // Increment counter in both processes
        counter++;
    int pid = fork();
    printf("Counter value: %d\\n", counter);
    
    // Each process calculates something
    int result = pid * 10 + counter;
    printf("Result: %d\\n", result);
    
    return 0;
}`,
  children: [
  {
      id: 'child-root-1001',
      name: '1000',
      description: 'Start node',
      hasImage: true,
      imageUrl: 'https://picsum.photos/50/50',
      hasIcon: true,
      customHtml: "<div class='custom-content'><button><i class='fas fa-cog'></i> Click me</button></div>",
      code: `#include <stdio.h>
#include <process.h>

int main() {
    // Initialize variables
    int counter = 0;
    int sum = 0;
    int sum2 = 0;
    int sum3 = 0;

    // Without a return statement, C++ will throw an error
    // Add proper code here
    printf("Child node executing\\n");
    
    return 0; // Add proper return statement
}`
    }
    ]
};

const App: React.FC = () => {
  const [data, setData] = useState<TreeNode>(initialData);
  const [stats, setStats] = useState({ generation: 1, totalNodes: 2 });
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [isHorizontalLayout, setIsHorizontalLayout] = useState(false);
  const [boxDimensions, setBoxDimensions] = useState({ width: 180, height: 120 });
  const [isDebugging, setIsDebugging] = useState(false);
  const [currentLine, setCurrentLine] = useState<number>(-1);
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [showTree, setShowTree] = useState(true);
  const debuggerRef = useRef<any>(null);
  const [output, setOutput] = useState<string>('');
  const [input, setInput] = useState<string>('');
  const processedForkCallsRef = useRef<{[key: number]: boolean}>({});
  const nodesCreatedThisStepRef = useRef<{[key: string]: boolean}>({});

  // Calculate available space for visualization
  const headerHeight = 0; // Removed heading and description
  const windowHeight = window.innerHeight;
  const availableHeight = windowHeight - headerHeight - 40; // 40px for margins

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
    
    // Get the source code before anything else
    const code = sourceDebugger.getSourceCode ? sourceDebugger.getSourceCode() : '';
    if (!code) {
      console.error('Cannot clone debugger: source code not available');
      return null;
    }
    
    // Create a new debugger instance with the correct handlers
    const handleOutputChange = (newOutput: string) => {
      setOutput(prevOutput => prevOutput + newOutput);
    };

    const handleLineChange = (line: number, nodeId: string) => {
      setData(prevData => {
        return updateNodeProperty(prevData, nodeId, 'currentLine', line);
      });
    };
    
    // Create new debugger but indicate it's a child process
    const clonedDebugger = new CPPDebugger(
      handleOutputChange,
      (line: number) => handleLineChange(line, newNodeId),
      newNodeId,
      true // This is a child process - CRITICAL to prevent fork loops
    );
    
    // Set the line change handler directly
    clonedDebugger.lineChangeHandler = (line: number) => handleLineChange(line, newNodeId);
    
    // Copy input state
    clonedDebugger.setInput(sourceDebugger.input || '');
    
    try {
      // Get parent variables before we start the child process
      const parentVariables = sourceDebugger.getVariables ? sourceDebugger.getVariables() : [];
      
      // Get the current line from the parent
      const parentLine = sourceDebugger.getCurrentLine ? 
        sourceDebugger.getCurrentLine() : 
        (sourceDebugger.debugger?.nextNode ? 
          (sourceDebugger.debugger.nextNode().sLine - 1) : -1);
      
      console.log(`Parent is at line ${parentLine}, starting child process debugging`);
      
      // Use specialized cloning function if available
      if (typeof sourceDebugger.cloneInternalState === 'function') {
        console.log(`Using specialized cloneInternalState function for node ${newNodeId}`);
        
        // This function should handle all the cloning logic including variable copying
        sourceDebugger.cloneInternalState(clonedDebugger);
        
        // Set pid to 0 explicitly after cloning state
        if (clonedDebugger.setVariable) {
          clonedDebugger.setVariable('pid', '0');
          console.log(`Set child process pid to 0 after cloning state`);
        }
      } else {
        console.log(`Using manual state cloning for node ${newNodeId}`);
        
        // Start debugging with the same code (synchronously if possible)
        if (clonedDebugger.startDebugSync) {
          console.log(`Starting child debugger synchronously with code length ${code.length}`);
          clonedDebugger.startDebugSync(code);
        } else {
          console.log(`Starting child debugger asynchronously`);
          clonedDebugger.startDebug(code);
        }
        
        console.log(`Child debugger started, now at line ${clonedDebugger.getCurrentLine?.() || 'unknown'}`);
        
        // Need to step the debugger to reach the correct line
        if (parentLine > 0) {
          console.log(`Attempting to position child process at parent line ${parentLine}`);
          
          // Approach 1: Set current line directly if available
          if (clonedDebugger.setCurrentLine) {
            clonedDebugger.setCurrentLine(parentLine);
            console.log(`Set child current line to ${parentLine} using setCurrentLine`);
          }
          
          // Approach 2: Step through the program until we reach the parent's line
          let currentChildLine = clonedDebugger.getCurrentLine?.() || 0;
          console.log(`Child initially at line ${currentChildLine}, need to reach ${parentLine}`);
          
          // If the child is at an earlier line, step forward to match parent
          let attempts = 0;
          while (clonedDebugger.isDebugging() && currentChildLine < parentLine && attempts < 100) {
            console.log(`Stepping child from line ${currentChildLine} toward ${parentLine}`);
            clonedDebugger.stepNext();
            currentChildLine = clonedDebugger.getCurrentLine?.() || 0;
            attempts++;
          }
          
          console.log(`Child positioned at line ${currentChildLine} after ${attempts} steps`);
        }
        
        // Now copy all variables from parent to child
        if (parentVariables && parentVariables.length > 0) {
          console.log(`Copying ${parentVariables.length} variables from parent to child`);
          
          // Map variables to ensure pid is 0 for child process
          const childVars = parentVariables.map(v => {
            if (v.name === 'pid') {
              return { ...v, value: '0' }; // Child sees pid=0
            }
            return { ...v };
          });
          
          // Set all variables on the child
          if (clonedDebugger.setVariables) {
            clonedDebugger.setVariables(childVars);
            console.log(`Variables copied to child process`);
          }
          
          // Explicitly set pid variable if available
          if (clonedDebugger.setVariable) {
            clonedDebugger.setVariable('pid', '0');
            console.log(`Explicitly set child pid to 0`);
          }
        }
        
        // For a child process created by fork(), advance it past the fork() call
        // This prevents the child from executing the fork() again
        try {
          console.log(`Attempting to advance child past fork() line`);
          
          if (clonedDebugger.debugger && clonedDebugger.debugger.nextNode) {
            const nextNode = clonedDebugger.debugger.nextNode();
            if (nextNode && nextNode.sLine) {
              // Get current line
              const currentLine = nextNode.sLine - 1;
              console.log(`Current child line: ${currentLine}`);
              
              // Only advance if we're at a fork line (look for "fork" in code at this line)
              const lines = code.split('\n');
              if (currentLine < lines.length) {
                const currentLineCode = lines[currentLine];
                if (currentLineCode.includes('fork(')) {
                  console.log(`Child is at a fork line "${currentLineCode}", advancing past it`);
                  
                  // Step once to move past the fork
                  clonedDebugger.stepNext();
                  
                  const afterPosition = clonedDebugger.getCurrentLine?.() || -1;
                  console.log(`Child now positioned at line ${afterPosition} (after fork)`);
                } else {
                  console.log(`Child line doesn't appear to be a fork call: "${currentLineCode}"`);
                }
              }
            }
          }
        } catch (e) {
          console.error("Error positioning child process after fork:", e);
        }
      }
      
      // Final verification: ensure child pid is 0
      if (clonedDebugger.setVariable) {
        clonedDebugger.setVariable('pid', '0');
        console.log(`Final verification: Set child process pid to 0`);
      }
      
      // Verify pid was set correctly by checking variables
      const childVars = clonedDebugger.getVariables?.() || [];
      const pidVar = childVars.find((v: any) => v.name === 'pid');
      console.log(`Child pid verification: ${pidVar ? `pid=${pidVar.value}` : 'pid not found'}`);
      
    } catch (error) {
      console.error('Error cloning debugger state:', error);
    }
    
    return clonedDebugger;
  };

  const addChildToRoot = () => {
    setData(prevData => ({
      ...prevData,
      children: [...(prevData.children || []), createNewNode(prevData)]
    }));
  };

  const addChildToAllNodes = () => {
    const addChildrenRecursively = (node: TreeNode): TreeNode => ({
      ...node,
      children: [
        ...(node.children || []).map(addChildrenRecursively),
        createNewNode(node)
      ]
    });

    setData(addChildrenRecursively);
  };

  const addRandomChild = () => {
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

    setData(prevData => addChildToNode(prevData, randomNode.id));
  };

  const updateStats = useCallback((generation: number, totalNodes: number) => {
    setStats({ generation, totalNodes });
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

    const handleLineChange = (line: number, nodeId: string) => {
      // Update the specific node's current line
      setData(prevData => {
        return updateNodeProperty(prevData, nodeId, 'currentLine', line);
      });
    };

    // CRITICAL: Create the debugger instance with the node ID
    // This ensures the JSCPP runtime knows which node it belongs to
    const debuggerInstance = new CPPDebugger(
      handleOutputChange,
      (line: number) => handleLineChange(line, nodeId),
      nodeId, // Pass the node ID to the debugger instance
      isChildProcess // Pass whether this is a child process
    );
    
    console.log(`Created debugger with nodeId=${nodeId}`);
    
    // Make sure we can access the line change handler directly
    debuggerInstance.lineChangeHandler = (line: number) => handleLineChange(line, nodeId);
    
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
    // Reset all nodes first
    setData(prevData => {
      const resetDebugging = (node: TreeNode): TreeNode => ({
        ...node,
        debuggerInstance: undefined,
        currentLine: -1,
        isDebugging: false,
        children: node.children ? node.children.map(resetDebugging) : undefined
      });
      return resetDebugging(prevData);
    });

    // Now create new debuggers for each node
    setData(prevData => {
      const initNode = (node: TreeNode): TreeNode => {
        const debuggerInstance = createNodeDebugger(node.id, node.code || '', false);
        
        return {
          ...node,
          debuggerInstance,
          isDebugging: true,
          currentLine: -1,
          children: node.children ? node.children.map(initNode) : undefined
        };
      };
      return initNode(prevData);
    });

    // Start all debuggers
    setData(prevData => {
      const startDebugging = async (node: TreeNode): Promise<TreeNode> => {
        if (node.debuggerInstance && node.code) {
          try {
            await node.debuggerInstance.startDebug(node.code);
          } catch (error) {
            console.error(`Failed to start debugging for node ${node.id}:`, error);
          }
        }
        
        return {
          ...node,
          children: node.children 
            ? await Promise.all(node.children.map(startDebugging)) 
            : undefined
        };
      };
      
      // Start with a copy then await all the async operations
      const nodeCopy = { ...prevData };
      startDebugging(nodeCopy).then(); // Fire and forget
      return nodeCopy;
    });
  };

  // Function to step all debuggers
  const stepAllDebuggers = () => {
    // Reset processed fork calls when stepping
    // This ensures we can process fork calls again on each step
    processedForkCallsRef.current = {};
    
    // Clear the list of nodes created this step
    const nodesCreatedThisStep = Object.keys(nodesCreatedThisStepRef.current);
    if (nodesCreatedThisStep.length > 0) {
      console.log(`Not stepping ${nodesCreatedThisStep.length} nodes created in previous step:`, nodesCreatedThisStep);
    }
    nodesCreatedThisStepRef.current = {};
    
    console.log('Stepping all debuggers...');
    
    // First step all debuggers
    setData(prevData => {
      const stepNode = (node: TreeNode): TreeNode => {
        // Skip nodes that were created in the previous step
        // This prevents child nodes from executing on the same step they were created
        if (nodesCreatedThisStep.indexOf(node.id) >= 0) {
          console.log(`Skipping step for newly created node ${node.id}`);
          return node;
        }
        
        if (node.debuggerInstance && node.isDebugging) {
          try {
            console.log(`Stepping debugger for node ${node.id}`);
            
            // Step the debugger
            node.debuggerInstance.stepNext();
            
            // If debugging has finished for this node
            if (!node.debuggerInstance.isDebugging()) {
              console.log(`Debugging finished for node ${node.id}`);
              return {
                ...node,
                isDebugging: false,
                currentLine: -1,
                children: node.children ? node.children.map(stepNode) : []
              };
            }
            
            // Ensure the currentLine property is updated from the debugger
            const nextNode = node.debuggerInstance.debugger?.nextNode?.();
            const currentLine = nextNode ? nextNode.sLine - 1 : -1;
            
            // Get variables to ensure they're updated in the UI
            if (node.debuggerInstance.getVariables) {
              const variables = node.debuggerInstance.getVariables();
              console.log(`Node ${node.id} variables:`, variables);
            }
            
            return {
              ...node,
              currentLine: currentLine,
              children: node.children ? node.children.map(stepNode) : []
            };
          } catch (error) {
            console.error(`Failed to step debugger for node ${node.id}:`, error);
            return {
              ...node,
              isDebugging: false,
              currentLine: -1,
              children: node.children ? node.children.map(stepNode) : []
            };
          }
        }
        
        return {
          ...node,
          children: node.children ? node.children.map(stepNode) : []
        };
      };
      
      // Step the entire tree
      return stepNode(prevData);
    });
    
    // Now process any pending fork events - CRITICAL: this must happen
    // after all nodes have been stepped forward to the next instruction
    console.log("Step complete, now processing any pending fork events...");
    
    // Process pending forks AFTER stepping - this ensures the parent process
    // has moved past the fork() call before the child is created
    setTimeout(() => {
      // Explicitly call processPendingForks to handle any queued fork operations
      forkEventBus.processPendingForks();
      
      // Force a refresh of the UI after processing forks to ensure new nodes are visible
      setData(prevData => {
        console.log("Refreshing tree state after processing forks");
        return { ...prevData };
      });
    }, 0);  // Use a short timeout to ensure this runs after the step is complete
  };

  // Function to stop all debuggers
  const stopAllDebuggers = () => {
    setData(prevData => {
      const stopNode = (node: TreeNode): TreeNode => {
        if (node.debuggerInstance) {
          node.debuggerInstance.stop();
        }
        
        return {
          ...node,
          debuggerInstance: undefined,
          isDebugging: false,
          currentLine: -1,
          children: node.children ? node.children.map(stopNode) : undefined
        };
      };
      
      return stopNode(prevData);
    });
    
    // Clear the output area for next run
    setOutput('');
  };

  const handleRunProgram = () => {
    // Reset the processed fork calls
    processedForkCallsRef.current = {};
    
    console.log('Starting program and initializing debuggers...');
    setIsDebugging(true);
    
    // Reset any pending fork operations
    if (typeof forkEventBus.clearPendingForks === 'function') {
      forkEventBus.clearPendingForks(); // Clear any queued forks from previous runs
    }
    
    initializeAllDebuggers();
    setShowTree(true);
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
    
    // Force refresh the variables UI using multiple stages
    // This ensures that variables are properly updated across the tree
    
    // First refresh - immediately after stepping
    setData(prevData => ({ ...prevData }));
    
    // Second refresh - after a delay to allow JSCPP runtime to update
    setTimeout(() => {
      setData(prevData => ({ ...prevData }));
      
      // Third refresh - after another delay to capture any late updates
      setTimeout(() => {
        setData(prevData => ({ ...prevData }));
      }, 100);
    }, 50);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    
    // Update input for all active debuggers
    setData(prevData => {
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
    setData(initialData);
    setShowTree(false);
    setIsDebugging(false);
    setCurrentLine(-1);
    nextNodeNumber = 1001;
  };

  const handleSplitterResize = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth);
  }, []);

  const handleCodeChange = useCallback((newCode: string) => {
    setData(prevData => ({
      ...prevData,
      code: newCode
    }));
  }, []);

  // Store a reference to the debugger instance when it's created
  const handleDebuggerCreated = (debuggerInstance: any) => {
    debuggerRef.current = debuggerInstance;
  };

  // Calculate canvas width based on window width minus sidebar width
  const canvasWidth = window.innerWidth - sidebarWidth - 6; // 6px for splitter width

  // Fork handling: Listen for fork events from the custom functions
  useEffect(() => {
    console.log("Setting up fork event listener");
    
    // Register the event listener
    forkEventBus.on('fork', handleForkEvent);
    console.log("Fork event listener registered");
    
    // Cleanup function to remove the listener
    return () => {
      // Remove the event listener if possible
      if (typeof forkEventBus.off === 'function') {
        forkEventBus.off('fork', handleForkEvent);
        console.log("Fork event listener removed");
      }
    };
  }, []);

  const handleForkEvent = (forkEvent: { 
    nodeId: string; 
    forkCallId: number;
    childPid?: number;    // Child's process ID (positive)
    parentPid?: number;   // Parent's process ID (usually 0 for child)
  }) => {
    console.log('Fork event received:', forkEvent);
    
    // Detailed debug information about the fork event
    console.log(`Fork #${forkEvent.forkCallId} from nodeId=${forkEvent.nodeId}, childPid=${forkEvent.childPid}`);
    
    // Only handle each fork call once
    if (processedForkCallsRef.current[forkEvent.forkCallId]) {
      console.log(`Fork call ${forkEvent.forkCallId} already processed, skipping`);
      return;
    }
    
    // Mark this fork call as processed
    processedForkCallsRef.current[forkEvent.forkCallId] = true;
    console.log(`Marked fork call ${forkEvent.forkCallId} as processed`);
    
    setTimeout(() => {
      console.log(`Processing fork event with ID ${forkEvent.forkCallId} for node ${forkEvent.nodeId}`);
      
      // Find the parent node by ID and update tree
      setData(prevData => {
        // Print the current tree state for debugging
        console.log(`Current tree has ${getNodeCount(prevData)} nodes before fork`);
        
        // We'll track the ID of any newly created node
        let newNodeId: string | null = null;
        
        // Function to recursively search for the parent node and add a child
        const updateTreeWithFork = (node: TreeNode): TreeNode => {
          // EXACT node ID match - only add child to the specific node that called fork
          if (node.id === forkEvent.nodeId) {
            // Found the parent node that called fork()
            console.log(`Found parent node ${node.id} at line ${node.currentLine}`);
            
            // ADDITIONAL CHECK: Verify this node is actually capable of forking
            // First make sure it has a debugger instance and is debugging
            if (!node.debuggerInstance || !node.isDebugging) {
              console.log(`Node ${node.id} is not in debugging state, cannot fork`);
              return node; // Return node unchanged
            }
            
            // Create a proper deep clone of the parent node
            const childNode = createNewNode(node);
            
            console.log(`Created child node ${childNode.id} from parent ${node.id}`);
            
            // Store the new node ID to track it as created this step
            newNodeId = childNode.id;
            
            // Make sure child debugger has pid set to 0 if it exists
            if (childNode.debuggerInstance && childNode.debuggerInstance.setVariable) {
              childNode.debuggerInstance.setVariable('pid', '0');
              console.log(`Set child node ${childNode.id} pid to 0`);
            }
            
            // Return parent node with the new child added
            return {
              ...node,
              children: [...(node.children || []), childNode]
            };
          }
          
          // Not the target node, check children recursively
          if (node.children && node.children.length > 0) {
            const newChildren = node.children.map(updateTreeWithFork);
            // Check if any children were modified
            const hasChanges = newChildren.some((newChild, i) => newChild !== node.children[i]);
            if (hasChanges) {
              return {
                ...node,
                children: newChildren
              };
            }
          }
          
          // Not a match and no children were changed, return unchanged
          return node;
        };
        
        // Apply the update function to the entire tree
        const updatedData = updateTreeWithFork(prevData);
        
        // If a new node was created, track it to prevent stepping it right away
        if (newNodeId) {
          nodesCreatedThisStepRef.current[newNodeId] = true;
          console.log(`Marked node ${newNodeId} as created this step - will skip stepping until next cycle`);
        }
        
        console.log(`Tree update complete, now has ${getNodeCount(updatedData)} nodes`);
        return updatedData;
      });
    }, 0); // Use setTimeout to ensure this runs after the current execution
  };

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
            <button 
              className="btn-primary" 
              onClick={addChildToRoot}
              disabled={!showTree}
            >
              Add Child to Root
            </button>
            <button 
              className="btn-action" 
              onClick={addChildToAllNodes}
              disabled={!showTree}
            >
              Add Child To All Nodes
            </button>
            <button 
              className="btn-random" 
              onClick={addRandomChild}
              disabled={!showTree}
            >
              Add Random Child
            </button>
            <button
              className="btn-reset"
              onClick={handleResetTree}
            >
              Reset Tree
            </button>
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
          </div>

          <div className="control-group">
            <div className="control-item">
              <label>Node Width:</label>
              <input
                type="range"
                min="100"
                max="500"
                value={boxDimensions.width}
                onChange={(e) => setBoxDimensions(prev => ({ ...prev, width: parseInt(e.target.value) }))}
                className="dimension-slider"
              />
              <span>{boxDimensions.width}px</span>
            </div>
            <div className="control-item">
              <label>Height:</label>
              <input
                type="range"
                min="80"
                max="500"
                value={boxDimensions.height}
                onChange={(e) => setBoxDimensions(prev => ({ ...prev, height: parseInt(e.target.value) }))}
                className="dimension-slider"
              />
              <span>{boxDimensions.height}px</span>
            </div>
          </div>

          <DebugPanel
            code={data.code || ''}
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
          />

          <div className="stats">
            <div className="stat-item">
              <div className="stat-label">Generation</div>
              <div className="stat-value">{stats.generation}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Total Nodes</div>
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
          {showTree ? (
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
              onStatsUpdate={updateStats}
              currentLine={currentLine}
              onNodeResize={handleNodeResize}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div className="empty-canvas-message" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p>Run the program to visualize the execution tree</p>
            </div>
          )}
        </div>
        
        {/* Floating Variables UI */}
        <FloatingVarUI isDebugging={isDebugging} debuggerRef={debuggerRef} data={data} />
      </div>
    </div>
  );
};

export default App; 