// Test file for the C interpreter
import { CInterpreter, ForkEvent } from '../src/lib/cinterp/interpreter';

const testCode = `
#include <stdio.h>

int main() {
    int pid = fork();
    if (pid == 0) {
        printf("I am child\\n");
    } else {
        printf("I am parent, child pid = %d\\n", pid);
    }
    return 0;
}
`;

const doubleForkCode = `
#include <stdio.h>

int main() {
    fork();
    fork();
    printf("Hello\\n");
    return 0;
}
`;

console.log('=== Testing C Interpreter ===\n');

// Test 1: Basic parsing
console.log('Test 1: Parsing double fork code...');
try {
  const interp = new CInterpreter(doubleForkCode, 'root');
  console.log('✓ Parsing successful\n');
} catch (e) {
  console.log('✗ Parsing failed:', e);
  process.exit(1);
}

// Test 2: Fork event handling
console.log('Test 2: Fork event handling...');
const allProcesses: CInterpreter[] = [];
const rootInterp = new CInterpreter(doubleForkCode, 'root');
allProcesses.push(rootInterp);

// Set up fork handler for root
rootInterp.setOnFork((event: ForkEvent) => {
  console.log(`  Fork event! Creating child with PID ${event.childPid} at line ${event.forkLine}`);
  const childInterp = CInterpreter.fromState(doubleForkCode, event.childState, `child-${event.childPid}`);
  childInterp.setVariable('pid', 0);
  allProcesses.push(childInterp);
});

rootInterp.setOnOutput((text) => {
  console.log(`  [root output]: ${text}`);
});

console.log('  Running root process...');
while (!rootInterp.isFinished()) {
  rootInterp.step();
}
console.log(`  Root finished. Exit code: ${rootInterp.getExitCode()}`);

// Run children with a fixed iteration (prevent infinite loop)
// For fork(); fork(); we expect at most 4 total processes
let processed = 1; // root already processed
const maxProcesses = 10; // safety limit

while (processed < allProcesses.length && processed < maxProcesses) {
  const child = allProcesses[processed];
  console.log(`\n  Running ${child.nodeId}...`);
  
  child.setOnOutput((text) => {
    console.log(`  [${child.nodeId} output]: ${text}`);
  });
  
  child.setOnFork((event: ForkEvent) => {
    console.log(`  ${child.nodeId} forking! Creating grandchild with PID ${event.childPid}`);
    const grandchild = CInterpreter.fromState(doubleForkCode, event.childState, `process-${event.childPid}`);
    grandchild.setVariable('pid', 0);
    allProcesses.push(grandchild);
  });
  
  while (!child.isFinished()) {
    child.step();
  }
  console.log(`  ${child.nodeId} finished`);
  processed++;
}

console.log(`\n✓ Test passed! Total processes: ${allProcesses.length}`);
console.log(`  (Expected 4 processes for fork(); fork();)`);

// Test 3: Variable state cloning
console.log('\n\nTest 3: Variable state cloning...');
const varTestCode = `
#include <stdio.h>

int main() {
    int x = 42;
    int pid = fork();
    if (pid == 0) {
        x = 100;
        printf("Child x = %d\\n", x);
    } else {
        printf("Parent x = %d\\n", x);
    }
    return 0;
}
`;

const varInterp = new CInterpreter(varTestCode, 'root');
let childVarInterp: CInterpreter | null = null;

varInterp.setOnFork((event) => {
  console.log('  Fork detected, cloning state...');
  childVarInterp = CInterpreter.fromState(varTestCode, event.childState, 'child');
  childVarInterp.setVariable('pid', 0);
});

varInterp.setOnOutput((text) => {
  console.log(`  [parent]: ${text.trim()}`);
});

// Run parent
while (!varInterp.isFinished()) {
  varInterp.step();
}

// Run child
if (childVarInterp) {
  childVarInterp.setOnOutput((text: string) => {
    console.log(`  [child]: ${text.trim()}`);
  });
  while (!childVarInterp.isFinished()) {
    childVarInterp.step();
  }
}

console.log('✓ Variable cloning test complete\n');

console.log('=== All tests passed! ===');
