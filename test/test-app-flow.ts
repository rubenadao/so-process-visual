// Test the exact flow that App.tsx uses
import { CInterpDebugger, InterpreterState, ForkEvent } from '../src/lib/cinterp';

const code = `#include <stdio.h>
#include <unistd.h>

int main() {
    fork();
    fork();
    return 0;
}`;

interface TreeNode {
  id: string;
  name: string;
  code: string;
  debuggerInstance: CInterpDebugger | null;
  isDebugging: boolean;
  currentLine: number;
  children: TreeNode[];
}

let nodeIdCounter = 0;
const generateNodeId = () => `node-${++nodeIdCounter}`;

// Simulating the processedForkCallsRef
const processedForkCalls: Record<string, boolean> = {};

// Create the tree
let rootNode: TreeNode = {
  id: 'root',
  name: '1000',
  code: code,
  debuggerInstance: null,
  isDebugging: false,
  currentLine: -1,
  children: []
};

// Function to find a node by ID
function findNode(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// Count total nodes
function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// Setup fork handler - mirrors App.tsx setupForkHandler
function setupForkHandler(debugger_: CInterpDebugger, nodeId: string) {
  console.log(`Setting up fork handler for node ${nodeId}`);
  
  debugger_.setOnFork((event: ForkEvent) => {
    console.log(`FORK EVENT from ${nodeId}: childPid=${event.childPid}`);
    
    const forkKey = `${nodeId}-${event.childPid}`;
    if (processedForkCalls[forkKey]) {
      console.log(`  Fork ${forkKey} already processed, skipping`);
      return;
    }
    processedForkCalls[forkKey] = true;
    
    const childState = event.childState;
    if (!childState) {
      console.error('Fork event missing child state');
      return;
    }
    
    // Find the parent node
    const parentNode = findNode(rootNode, nodeId);
    if (!parentNode) {
      console.error(`Parent node ${nodeId} not found`);
      return;
    }
    
    // Create child debugger
    const newNodeId = generateNodeId();
    console.log(`Creating child node ${newNodeId} from parent ${nodeId}`);
    
    const childDebugger = CInterpDebugger.fromState(
      code,
      childState,
      newNodeId,
      (output) => console.log(`[${newNodeId}] Output: ${output}`),
      (line) => console.log(`[${newNodeId}] Line: ${line}`)
    );
    
    // Set up fork handler for child
    setupForkHandler(childDebugger, newNodeId);
    
    // Create child node
    const childNode: TreeNode = {
      id: newNodeId,
      name: `${event.childPid}`,
      code: code,
      debuggerInstance: childDebugger,
      isDebugging: true,
      currentLine: childDebugger.getCurrentLine(),
      children: []
    };
    
    // Add to parent
    parentNode.children.push(childNode);
    console.log(`Child ${newNodeId} added to ${nodeId}. Tree now has ${countNodes(rootNode)} nodes.`);
  });
}

// Create node debugger - mirrors App.tsx createNodeDebugger
function createNodeDebugger(nodeId: string): CInterpDebugger {
  console.log(`Creating debugger for node ${nodeId}`);
  
  const debugger_ = new CInterpDebugger(
    (output) => console.log(`[${nodeId}] Output: ${output}`),
    (line) => console.log(`[${nodeId}] Line changed to: ${line}`),
    nodeId,
    false
  );
  
  return debugger_;
}

// Initialize debuggers - mirrors App.tsx initializeAllDebuggers
function initializeAllDebuggers() {
  console.log('\n=== Initializing debuggers ===');
  
  const debuggerInstance = createNodeDebugger(rootNode.id);
  setupForkHandler(debuggerInstance, rootNode.id);
  debuggerInstance.startDebugSync(rootNode.code);
  
  rootNode.debuggerInstance = debuggerInstance;
  rootNode.isDebugging = true;
  rootNode.currentLine = debuggerInstance.getCurrentLine();
  
  console.log(`Root debugger initialized at line ${rootNode.currentLine}`);
}

// Step all debuggers - mirrors App.tsx stepAllDebuggers
function stepAllDebuggers() {
  console.log('\n=== Stepping all debuggers ===');
  
  function stepNode(node: TreeNode) {
    if (node.debuggerInstance && node.isDebugging) {
      if (!node.debuggerInstance.isDebugging()) {
        console.log(`  Node ${node.id} has finished`);
        node.isDebugging = false;
        node.currentLine = -1;
      } else {
        console.log(`  Stepping node ${node.id}...`);
        node.debuggerInstance.stepNext();
        node.currentLine = node.debuggerInstance.getCurrentLine();
        console.log(`    Now at line ${node.currentLine}, still debugging: ${node.debuggerInstance.isDebugging()}`);
      }
    }
    
    for (const child of node.children) {
      stepNode(child);
    }
  }
  
  stepNode(rootNode);
}

// Print tree
function printTree(node: TreeNode, indent: string = '') {
  const status = node.isDebugging ? `line ${node.currentLine}` : 'finished';
  console.log(`${indent}${node.id} (${node.name}) - ${status}`);
  for (const child of node.children) {
    printTree(child, indent + '  ');
  }
}

// Main test
console.log('=== Testing App.tsx Flow ===\n');
console.log('Code being tested:');
console.log(code);
console.log('\n');

initializeAllDebuggers();

console.log('\n=== Initial tree state ===');
printTree(rootNode);
console.log(`Total nodes: ${countNodes(rootNode)}`);

// Step through the program
for (let i = 0; i < 10; i++) {
  stepAllDebuggers();
  
  console.log(`\n=== Tree after step ${i + 1} ===`);
  printTree(rootNode);
  console.log(`Total nodes: ${countNodes(rootNode)}`);
  
  // Check if all nodes are done
  const allDone = (node: TreeNode): boolean => {
    if (node.isDebugging) return false;
    return node.children.every(allDone);
  };
  
  if (allDone(rootNode)) {
    console.log('\nAll processes finished!');
    break;
  }
}

console.log('\n=== Final Results ===');
console.log(`Total nodes created: ${countNodes(rootNode)}`);
console.log(`Expected: 4 (for fork(); fork();)`);

if (countNodes(rootNode) === 4) {
  console.log('\n✓ TEST PASSED!');
} else {
  console.log('\n✗ TEST FAILED!');
  process.exit(1);
}
